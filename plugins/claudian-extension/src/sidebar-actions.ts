import { setIcon } from "obsidian";
import type { App, WorkspaceLeaf } from "obsidian";
import type { SidebarDock, SidebarEntry, SidebarHandle, WidthLimit } from "./types";
const TOOLBAR_CLASS = "claudian-extension-top-toolbar";
const NAV_CLASS = "claudian-extension-nav-relocated";

export class SidebarActions {
    private entries = new Map<WorkspaceLeaf, SidebarEntry>();
    private handle?: SidebarHandle;
    private widthLimit?: WidthLimit;
    private disposed = false;

    constructor(private readonly app: App) {}

    sync() {
        if (this.disposed) return;
        const dock = this.app.workspace.rightSplit as SidebarDock;
        const dockEl = dock?.containerEl;
        const leaves = this.app.workspace.getLeavesOfType("claudian-view")
            .filter((leaf) => dockEl?.contains(leaf.view.containerEl));
        this.syncWidthLimit(dock, leaves.length > 0);
        const current = new Set<WorkspaceLeaf>();
        let visible = false;
        for (const leaf of leaves) {
            const view = leaf.view.containerEl;
            const panel = view.querySelector<HTMLElement>(".claudian-container > .claudian-chat-panel");
            const actions = view.querySelector<HTMLElement>(".claudian-input-nav-actions");
            if (!panel || !actions) continue;
            const previous = this.entries.get(leaf);
            if (previous && (previous.panel !== panel || previous.actions !== actions
                || !previous.marker.isConnected || previous.toolbar.parentElement !== panel
                || actions.parentElement !== previous.toolbar)) {
                this.detach(leaf);
            }
            const entry = this.entries.get(leaf) ?? this.attach(leaf, panel, actions);
            if (!entry) continue;
            current.add(leaf);
            const bounds = panel.getBoundingClientRect();
            if (bounds.width > 0 && bounds.height > 0) visible = true;
            const menuHeight = `${Math.max(0, bounds.height - 40)}px`;
            if (entry.menuHeight !== menuHeight) {
                entry.toolbar.style.setProperty("--claudian-extension-menu-height", menuHeight);
                entry.menuHeight = menuHeight;
            }
        }
        for (const leaf of this.entries.keys()) {
            if (!current.has(leaf)) this.detach(leaf);
        }
        this.syncHandle(dock, visible, leaves.length > 0);
    }

    syncWidthLimit(dock: SidebarDock, enabled: boolean) {
        if (this.widthLimit && (this.widthLimit.dock !== dock || !enabled)) this.restoreWidthLimit();
        if (!enabled || this.widthLimit || typeof dock?.setSize !== "function") return;
        const dockEl = dock.containerEl;
        const win = dockEl.ownerDocument.defaultView;
        const maximum = Number.parseFloat(win?.getComputedStyle(dockEl).maxWidth ?? "");
        if (!Number.isFinite(maximum) || maximum <= 0) return;
        const limit: WidthLimit = {
            dock,
            original: dock.setSize,
            descriptor: Object.getOwnPropertyDescriptor(dock, "setSize"),
            enabled: true,
            setSize(width) { return limit.original.call(this, limit.enabled ? Math.min(width, maximum) : width); }
        };
        // Clamp the stored size as well as CSS, including native drag and restore paths.
        // Otherwise collapse/expand animations can use an oversized child min-width.
        dock.setSize = limit.setSize;
        this.widthLimit = limit;
        if (dock.size > maximum) dock.setSize(maximum);
    }

    restoreWidthLimit() {
        const limit = this.widthLimit;
        if (!limit) return;
        limit.enabled = false;
        if (limit.dock.setSize === limit.setSize) {
            if (limit.descriptor) Object.defineProperty(limit.dock, "setSize", limit.descriptor);
            else delete limit.dock.setSize;
        }
        this.widthLimit = undefined;
    }

    attach(leaf: WorkspaceLeaf, panel: HTMLElement, actions: HTMLElement): SidebarEntry | undefined {
        const nav = actions.closest<HTMLElement>(".claudian-view-input-nav-row");
        if (!nav || !actions.querySelector<HTMLElement>(".claudian-new-tab-btn")
            || !actions.querySelector<HTMLElement>(".claudian-new-conversation-btn")
            || !actions.querySelector<HTMLElement>(".claudian-history-container")) return undefined;
        const doc = panel.ownerDocument;
        const marker = doc.createComment("claudian-extension-navigation-position");
        const toolbar = doc.createElement("div");
        toolbar.className = TOOLBAR_CLASS;
        toolbar.setAttribute("role", "group");
        toolbar.setAttribute("aria-label", "Conversation actions");
        actions.before(marker);
        // Move the original controls, including the history menu and its listeners.
        toolbar.append(actions);
        panel.prepend(toolbar);
        nav.classList.add(NAV_CLASS);
        const entry = { panel, actions, nav, marker, toolbar };
        this.entries.set(leaf, entry);
        return entry;
    }

    syncHandle(dock: SidebarDock, visible: boolean, hasClaudian: boolean) {
        const dockEl = dock?.containerEl;
        if (!dockEl?.isConnected || !hasClaudian || (!dock.collapsed && !visible)
            || typeof dock.collapse !== "function" || typeof dock.expand !== "function") {
            this.removeHandle();
            return;
        }
        if (this.handle?.dock !== dock) this.removeHandle();
        if (!this.handle) {
            const doc = dockEl.ownerDocument;
            const edge = doc.createElement("div");
            edge.className = "claudian-extension-edge";
            const button = doc.createElement("button");
            button.type = "button";
            button.className = "claudian-extension-collapse";
            const onClick = (event: MouseEvent) => {
                event.preventDefault();
                event.stopPropagation();
                // Both actions preserve the existing view, tabs, and ongoing work.
                if (dock.collapsed) dock.expand();
                else dock.collapse();
                this.sync();
            };
            const onPointerDown = (event: PointerEvent) => event.stopPropagation();
            button.addEventListener("click", onClick);
            button.addEventListener("pointerdown", onPointerDown);
            // A fixed overlay avoids clipping by the sidebar's overflow containers.
            edge.append(button);
            doc.body.append(edge);
            this.handle = { dock, edge, button, onClick, onPointerDown };
        }
        const { edge, button } = this.handle;
        const collapsed = dock.collapsed;
        const mode = collapsed ? "expand" : "collapse";
        if (edge.dataset.mode !== mode) {
            edge.dataset.mode = mode;
            button.setAttribute("aria-label", collapsed ? "Expand right sidebar" : "Collapse right sidebar");
            button.setAttribute("aria-expanded", String(!collapsed));
            setIcon(button, collapsed ? "chevron-left" : "chevron-right");
            button.querySelector<HTMLElement>("svg")?.setAttribute("aria-hidden", "true");
        }
        // A collapsed dock has no usable bounds; anchor its reveal area to the workspace.
        const workspaceBounds = this.app.workspace.containerEl.getBoundingClientRect();
        const edgeTop = `${workspaceBounds.top}px`;
        const edgeHeight = `${workspaceBounds.height}px`;
        if (edge.style.top !== edgeTop) edge.style.top = edgeTop;
        if (edge.style.height !== edgeHeight) edge.style.height = edgeHeight;
        const bounds = collapsed ? workspaceBounds : dockEl.getBoundingClientRect();
        const left = collapsed ? "" : `${Math.max(0, bounds.left - 5.04)}px`;
        const right = collapsed ? "0px" : "";
        const top = `${bounds.top + bounds.height / 2}px`;
        if (button.style.left !== left) button.style.left = left;
        if (button.style.right !== right) button.style.right = right;
        if (button.style.top !== top) button.style.top = top;
    }

    removeHandle() {
        if (!this.handle) return;
        const { edge, button, onClick, onPointerDown } = this.handle;
        button.removeEventListener("click", onClick);
        button.removeEventListener("pointerdown", onPointerDown);
        edge.remove();
        this.handle = undefined;
    }

    detach(leaf: WorkspaceLeaf) {
        const entry = this.entries.get(leaf);
        if (!entry) return;
        this.entries.delete(leaf);
        // Do not pull controls back if Claudian has already moved them elsewhere.
        if (entry.actions.parentElement === entry.toolbar && entry.marker.parentNode) {
            entry.marker.replaceWith(entry.actions);
        } else {
            entry.marker.remove();
        }
        entry.toolbar.remove();
        entry.nav.classList.remove(NAV_CLASS);
    }

    dispose() {
        this.disposed = true;
        this.restoreWidthLimit();
        this.removeHandle();
        for (const leaf of this.entries.keys()) this.detach(leaf);
    }
}

