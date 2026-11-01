import { ModuleUnavailableError } from "../../../utils/module-errors";
import { resolveWindow } from "../../../utils/windows";

/** Single native dock adapter: all edge geometry changes pass through here. */
export class NativeWorkspace {
    constructor(app) { this.app = app; this.limits = new Map(); }

    window(context) {
        context.signal?.throwIfAborted();
        if (resolveWindow(context.windowId)?.document !== context.document) throw new ModuleUnavailableError("borders", "The workspace window was closed.");
        if (context.document !== this.app.workspace.containerEl.ownerDocument) {
            throw new ModuleUnavailableError("borders", "This window does not provide native sidebar or bottom-panel hosts.");
        }
        return this.app.workspace;
    }

    dock(edge, context) {
        const workspace = this.window(context);
        const dock = edge === "left" ? workspace.leftSplit : edge === "right" ? workspace.rightSplit : undefined;
        if (!dock?.containerEl || dock.containerEl.ownerDocument !== context.document) {
            throw new ModuleUnavailableError("borders", `The ${edge} sidebar is unavailable in this window.`);
        }
        return dock;
    }

    leaves(definition, context) {
        const dock = this.dock(definition.dock, context);
        return this.app.workspace.getLeavesOfType(definition.host.viewType).filter(leaf =>
            leaf.view.containerEl.ownerDocument === context.document && dock.containerEl.contains(leaf.view.containerEl));
    }

    async resolveLeaf(definition, context) {
        const existing = this.leaves(definition, context)[0];
        if (existing) { await existing.loadIfDeferred(); return existing; }
        const workspace = this.window(context);
        const leaf = definition.dock === "left" ? workspace.getLeftLeaf(false) : workspace.getRightLeaf(false);
        if (!leaf || leaf.view.containerEl.ownerDocument !== context.document) {
            throw new ModuleUnavailableError(definition.id, "The native panel host is unavailable in this window.");
        }
        await leaf.setViewState({ type: definition.host.viewType, active: false });
        context.signal?.throwIfAborted();
        return leaf;
    }

    visible(leaf, dock) {
        if (!leaf || dock.collapsed || !leaf.tabHeaderEl?.classList.contains("is-active")) return false;
        const bounds = leaf.view.containerEl.getBoundingClientRect();
        return bounds.width > 0 && bounds.height > 0;
    }

    async show(definition, context, leaf) {
        const dock = this.dock(definition.dock, context);
        if (dock.collapsed) dock.expand();
        await this.app.workspace.revealLeaf(leaf);
        this.setBounds(definition.dock, context, definition.bounds);
    }

    hide(edge, context) { this.dock(edge, context).collapse(); }

    capture(edge, context) {
        const dock = this.dock(edge, context);
        let selected;
        this.app.workspace.iterateAllLeaves(leaf => {
            if (dock.containerEl.contains(leaf.view.containerEl) && leaf.tabHeaderEl?.classList.contains("is-active")) selected = leaf;
        });
        return { collapsed: dock.collapsed, selected };
    }

    async restore(edge, context, previous) {
        const dock = this.dock(edge, context);
        if (previous.selected?.view.containerEl.isConnected) await this.app.workspace.revealLeaf(previous.selected);
        if (previous.collapsed) dock.collapse();
    }

    setSize(edge, context, width) {
        const dock = this.dock(edge, context);
        if (typeof dock.setSize === "function") dock.setSize(width);
        this.app.workspace.requestSaveLayout();
        this.app.workspace.requestResize?.();
    }

    bounds(edge, context, requested = {}) {
        const workspace = this.window(context).containerEl.getBoundingClientRect();
        const minimum = requested.minWidth ?? 0;
        const maximum = Math.max(minimum, Math.min(requested.maxWidth ?? Infinity,
            workspace.width * (requested.maxWidthRatio ?? 1)));
        return { minimum, maximum };
    }

    setBounds(edge, context, requested) {
        const dock = this.dock(edge, context);
        if (!requested) { this.restoreBounds(dock); return; }
        const limits = this.bounds(edge, context, requested);
        let record = this.limits.get(dock);
        if (!record) {
            const original = dock.setSize;
            record = { dock, original, enabled: true, descriptor: Object.getOwnPropertyDescriptor(dock, "setSize"), limits,
                min: dock.containerEl.style.getPropertyValue("min-width"), max: dock.containerEl.style.getPropertyValue("max-width"),
                minPriority: dock.containerEl.style.getPropertyPriority("min-width"), maxPriority: dock.containerEl.style.getPropertyPriority("max-width") };
            if (typeof original === "function") {
                record.wrapper = function (width) {
                    return original.call(this, record.enabled ? Math.max(record.limits.minimum, Math.min(width, record.limits.maximum)) : width);
                };
                dock.setSize = record.wrapper;
            }
            this.limits.set(dock, record);
        }
        record.limits = limits;
        record.appliedMin = dock.collapsed ? "0px" : `${limits.minimum}px`; record.appliedMax = `${limits.maximum}px`;
        if (dock.containerEl.style.getPropertyValue("min-width") !== record.appliedMin) dock.containerEl.style.setProperty("min-width", record.appliedMin);
        if (dock.containerEl.style.getPropertyValue("max-width") !== record.appliedMax) dock.containerEl.style.setProperty("max-width", record.appliedMax);
        if (!dock.collapsed && (dock.size > limits.maximum || dock.size < limits.minimum)) dock.setSize?.(dock.size);
    }

    restoreBounds(dock) {
        const record = this.limits.get(dock);
        if (!record) return;
        record.enabled = false;
        if (dock.setSize === record.wrapper) {
            if (record.descriptor) Object.defineProperty(dock, "setSize", record.descriptor);
            else delete dock.setSize;
        }
        for (const [property, old, applied, priority] of [["min-width", record.min, record.appliedMin, record.minPriority], ["max-width", record.max, record.appliedMax, record.maxPriority]]) {
            if (dock.containerEl.style.getPropertyValue(property) !== applied) continue;
            if (old) dock.containerEl.style.setProperty(property, old, priority);
            else dock.containerEl.style.removeProperty(property);
        }
        this.limits.delete(dock);
    }

    dispose() { for (const dock of this.limits.keys()) this.restoreBounds(dock); }
}
