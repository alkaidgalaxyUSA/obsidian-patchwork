import type { Plugin } from "obsidian";
import { isMarkdownView } from "../utils/markdown-views";
import { scopeModule, type ModuleScope } from "../../../utils/module-scope";
import { closeContentPortals, refreshContentPortals } from "../utils/portals";

/** Native document roots only; portal ownership stays with the feature creator. */
export function installContentSurfaces(plugin: Plugin): void {
    const roots = new Map<HTMLElement, ModuleScope>();
    let disposed = false;
    const sync = () => {
        if (disposed) return;
        const current = new Set<HTMLElement>();
        plugin.app.workspace.iterateAllLeaves(leaf => {
            if (!isMarkdownView(leaf.view)) return;
            const root = leaf.view.containerEl; current.add(root);
            if (!roots.has(root)) roots.set(root, scopeModule(root, "content", { surface: "markdown" }));
        });
        for (const [root, scope] of roots) if (!current.has(root)) { scope.dispose(); roots.delete(root); }
        refreshContentPortals();
    };
    plugin.registerEvent(plugin.app.workspace.on("layout-change", sync));
    plugin.registerEvent(plugin.app.workspace.on("file-open", sync));
    plugin.registerEvent(plugin.app.workspace.on("active-leaf-change", sync));
    plugin.registerInterval(plugin.app.workspace.containerEl.ownerDocument.defaultView!.setInterval(sync, 750));
    plugin.app.workspace.onLayoutReady(sync);
    plugin.register(() => { disposed = true; closeContentPortals(); for (const scope of roots.values()) scope.dispose(); roots.clear(); });
    sync();
}
