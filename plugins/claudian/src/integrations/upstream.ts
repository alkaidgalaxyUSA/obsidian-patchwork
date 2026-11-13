import type { App, Plugin, WorkspaceLeaf } from "obsidian";
import type { ClaudianView, ClaudianTab, UpstreamZenController } from "../types";
import { scopeModule, type ModuleScope } from "../../../utils/module-scope";

type UpstreamHost = App & {
    viewRegistry?: { viewByType?: Record<string, unknown> | Map<string, unknown> };
};

/** Named compatibility boundary for the separately installed upstream view. */
export function hasUpstreamPanel(app: App): boolean {
    if (app.workspace.getLeavesOfType("claudian-view").length) return true;
    const views = (app as UpstreamHost).viewRegistry?.viewByType;
    return views instanceof Map ? views.has("claudian-view") : typeof views?.["claudian-view"] === "function";
}

/** All upstream tab-manager discovery stays at this capability boundary. */
export function upstreamTabs(leaf: WorkspaceLeaf): ClaudianTab[] {
    const manager = (leaf.view as ClaudianView).getTabManager?.();
    return typeof manager?.getAllTabs === "function" ? manager.getAllTabs() : [];
}

export function activeUpstreamTab(leaf: WorkspaceLeaf): ClaudianTab | null | undefined {
    return (leaf.view as ClaudianView).getTabManager?.()?.getActiveTab?.();
}

/** Optional upstream capability; never resolve installed plugins by their IDs. */
export function upstreamZenController(leaf: WorkspaceLeaf): UpstreamZenController | undefined {
    const host = (leaf.view as ClaudianView).plugin;
    const controller = host?.domains?.zenMode ?? host?.zenMode;
    return typeof controller?.deps?.isEnabled === "function" && typeof controller.reconcile === "function" ? controller : undefined;
}

export function installClaudianSurfaces(plugin: Plugin): () => void {
    const roots = new Map<HTMLElement, ModuleScope>();
    let disposed = false;
    const sync = () => {
        if (disposed) return;
        const current = new Set<HTMLElement>();
        const documents = new Set([plugin.app.workspace.containerEl.ownerDocument]);
        plugin.app.workspace.iterateAllLeaves(leaf => {
            documents.add(leaf.view.containerEl.ownerDocument);
            if (leaf.view.getViewType() === "claudian-view") current.add(leaf.view.containerEl);
        });
        for (const doc of documents) {
            for (const root of doc.querySelectorAll<HTMLElement>(".claudian-zen-host > .claudian-container.claudian-zen, .claudian-zen-host > .claudian-extension-zen-dock")) current.add(root);
        }
        for (const root of current) if (!roots.has(root)) roots.set(root, scopeModule(root, "claudian"));
        for (const [root, scope] of roots) if (!current.has(root)) { scope.dispose(); roots.delete(root); }
    };
    plugin.registerEvent(plugin.app.workspace.on("layout-change", sync));
    plugin.registerInterval(plugin.app.workspace.containerEl.ownerDocument.defaultView!.setInterval(sync, 250));
    plugin.register(() => { disposed = true; for (const scope of roots.values()) scope.dispose(); roots.clear(); });
    plugin.app.workspace.onLayoutReady(sync);
    return sync;
}
