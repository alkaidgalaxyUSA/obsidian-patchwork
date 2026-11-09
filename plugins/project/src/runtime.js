import { Notice, TFolder } from "obsidian";
import { getServiceRegistry } from "../../utils/service-registry";
import { getWindowContext, resolveWindow } from "../../utils/windows";
import { scopeModule } from "../../utils/module-scope";
import { ModuleUnavailableError } from "../../utils/module-errors";
import { createNativePanel } from "../../utils/native-panel";
import { installExplorerActions } from "./explorer/explorer-actions";
import { installDocumentOpen } from "./explorer/document-open";
import { ExplorerStatus } from "./explorer/git-status";
import { FileMenus } from "./menus/file-menus";
import { installMenuStyles } from "./menus/index";
import { installProjectPreferences } from "./settings/preferences";
import { installSearchEverywhere } from "./search/search-everywhere";

/** Own native explorer content, selections and integrations independently of Content. */
export class ProjectRuntime {
    constructor(plugin) {
        this.plugin = plugin; this.app = plugin.app;
        this.views = new Map(); this.selected = new Map(); this.listeners = new Set();
        this.menus = new FileMenus(plugin);
        this.status = new ExplorerStatus(plugin);
    }

    install() {
        const plugin = this.plugin;
        installDocumentOpen(plugin);
        installExplorerActions(plugin, this);
        installMenuStyles(plugin);
        installProjectPreferences(plugin);
        installSearchEverywhere(plugin);
        this.stopBorders = getServiceRegistry(this.app).watch("project", "borders", borders => {
            this.panel?.dispose(); this.panel = undefined; this.stopStates?.();
            this.borders = borders;
            for (const view of this.views.keys()) view.containerEl.removeAttribute("data-pw-panel-focused");
            if (!borders) return;
            this.syncPanel();
            this.stopStates = borders.onPanelState(state => {
                if (state.id !== "project") return;
                for (const [view, record] of this.views) if (record.context.windowId === state.windowId) {
                    view.containerEl.setAttribute("data-pw-panel-focused", String(state.focused));
                }
            });
        });
        plugin.registerEvent(this.app.workspace.on("layout-change", () => this.syncPanel()));
        plugin.addCommand({ id: "open-project", name: "Open Project", callback: () => {
            const context = getWindowContext(this.app.workspace.containerEl.ownerDocument);
            void this.reveal(this.app.vault.getRoot().path, context).catch(error => new Notice(error.message));
        } });
    }

    syncPanel() {
        if (this.disposed) return;
        const available = this.app.internalPlugins?.plugins?.["file-explorer"]?.enabled || this.app.workspace.getLeavesOfType("file-explorer").length;
        if (!this.borders || !available) { this.panel?.dispose(); this.panel = undefined; return; }
        if (this.panel) return;
        this.panel = this.borders.registerPanel({
            id: "project", owner: "project", label: "Project", icon: "folder-outline", dock: "left",
            rail: "left", railGroup: "main", order: 10, host: { kind: "native-leaf", viewType: "file-explorer" },
            create: (host, context) => createNativePanel(this.app, host, context),
        });
    }

    context(context) {
        context.signal?.throwIfAborted();
        if (this.disposed || resolveWindow(context.windowId)?.document !== context.document) throw new ModuleUnavailableError("project", "The Project window was closed.");
    }

    registerView(view) {
        const context = getWindowContext(view.containerEl.ownerDocument);
        const scope = scopeModule(view.containerEl, "project");
        const record = { context, scope, compact: view.containerEl.getAttribute("data-pw-compact"), focused: view.containerEl.getAttribute("data-pw-panel-focused") };
        view.containerEl.setAttribute("data-pw-compact", String(!!this.plugin.settings.explorerCompact));
        this.views.set(view, record); this.status.add(view.containerEl);
        const state = getServiceRegistry(this.app).get("borders")?.getPanelState("project", context);
        view.containerEl.setAttribute("data-pw-panel-focused", String(state?.focused ?? false));
        this.selectionChanged(view);
        return () => {
            this.status.remove(view.containerEl); scope.dispose(); this.views.delete(view);
            view.containerEl.removeAttribute("data-pw-panel-focused");
            if (record.focused !== null) view.containerEl.setAttribute("data-pw-panel-focused", record.focused);
            if (record.compact === null) view.containerEl.removeAttribute("data-pw-compact"); else view.containerEl.setAttribute("data-pw-compact", record.compact);
            if (this.selected.get(context.windowId) === view) this.selected.delete(context.windowId);
            this.emit(context, this.getSelectionFor(context));
        };
    }

    selectionChanged(view, rootSelected = false) {
        const record = this.views.get(view); if (!record || this.disposed) return;
        record.rootSelected = rootSelected;
        this.selected.set(record.context.windowId, view);
        this.emit(record.context, this.getSelectionFor(record.context));
    }

    /** @returns {import("../../contracts/common").FileTarget[]} */
    getSelectionFor(context) {
        const view = this.selected.get(context.windowId) ?? [...this.views.keys()].find(view => view.containerEl.ownerDocument === context.document);
        if (!view) return [];
        if (this.views.get(view)?.rootSelected) return [{ path: this.app.vault.getRoot().path, kind: "directory" }];
        return [...view.tree.selectedDoms].map(item => item.file)
            .filter(file => this.app.vault.getAbstractFileByPath(file.path) === file)
            .map(file => ({ path: file.path, kind: file instanceof TFolder ? "directory" : "file" }));
    }

    getSelection(context) { this.context(context); return this.getSelectionFor(context); }
    onSelection(listener) {
        this.listeners.add(listener);
        const contexts = new Map([...this.views.values()].map(record => [record.context.windowId, record.context]));
        for (const context of contexts.values()) this.deliver(listener, context, this.getSelectionFor(context));
        return () => this.listeners.delete(listener);
    }
    deliver(listener, context, targets) {
        try { listener(context, targets.map(target => ({ ...target }))); }
        catch (error) { console.error("Project selection subscriber failed.", error); }
    }
    emit(context, targets) { for (const listener of [...this.listeners]) this.deliver(listener, context, targets); }

    async reveal(path, context) {
        this.context(context);
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!file) throw new ModuleUnavailableError("project", "The requested file is no longer available.");
        const borders = getServiceRegistry(this.app).get("borders");
        if (borders) await borders.openPanel("project", { context, focus: true });
        let leaf = this.app.workspace.getLeavesOfType("file-explorer").find(leaf => leaf.view.containerEl.ownerDocument === context.document);
        if (!leaf) {
            if (!this.app.internalPlugins?.plugins?.["file-explorer"]?.enabled) throw new ModuleUnavailableError("project", "Enable the Files core plugin to open Project.");
            if (context.document !== this.app.workspace.containerEl.ownerDocument) throw new ModuleUnavailableError("project", "This window has no native Project view.");
            leaf = await this.app.workspace.ensureSideLeaf("file-explorer", "left", { reveal: true });
        }
        await leaf.loadIfDeferred(); this.context(context);
        if (!leaf.view.containerEl.isConnected || leaf.view.containerEl.ownerDocument !== context.document) throw new ModuleUnavailableError("project", "The native Project view was closed.");
        if (!borders) await this.app.workspace.revealLeaf(leaf);
        this.context(context);
        if (!leaf.view.containerEl.isConnected || leaf.view.containerEl.ownerDocument !== context.document
            || this.app.vault.getAbstractFileByPath(path) !== file || typeof leaf.view.revealInFolder !== "function") {
            throw new ModuleUnavailableError("project", "The requested native Project target is no longer available.");
        }
        leaf.view.revealInFolder(file);
    }

    dispose() {
        this.disposed = true;
        this.stopBorders?.(); this.stopStates?.(); this.panel?.dispose();
        this.status.dispose(); this.menus.dispose(); this.listeners.clear();
        for (const [view, record] of this.views) {
            record.scope.dispose();
            if (record.focused === null) view.containerEl.removeAttribute("data-pw-panel-focused"); else view.containerEl.setAttribute("data-pw-panel-focused", record.focused);
            if (record.compact === null) view.containerEl.removeAttribute("data-pw-compact"); else view.containerEl.setAttribute("data-pw-compact", record.compact);
        }
        this.views.clear(); this.selected.clear();
    }
}
