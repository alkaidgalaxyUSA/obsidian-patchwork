import { ContentMenu as Menu } from "../utils/portals";
import { Notice } from "obsidian";
import { DocumentTabActions } from "./document-tab-actions";
import { appendDocumentTabActions } from "./document-tab-context-menu";

/** Activate without revealLeaf's transient highlight or leaving focus in the explorer. */
export async function activateDocumentTab(app, leaf) {
    try {
        if (!app.workspace.isAttached(leaf)) return;
        await leaf.loadIfDeferred();
        if (!app.workspace.isAttached(leaf)) return;
        app.workspace.setActiveLeaf(leaf, { focus: true });
        // Reselecting the same leaf does not emit active-leaf-change, but its tab
        // may still have been manually scrolled out of view.
        app.workspace.trigger("patchwork:document-tab-activated", leaf);
    } catch { new Notice("Could not activate the document tab."); }
}

export function documentTabsToClose(leaf, direction) {
    const siblings = leaf.parent?.children ?? [];
    const index = siblings.indexOf(leaf);
    if (index < 0) return [];
    return siblings.filter((item, position) => (direction === "all" || !item.pinned)
        && (direction === "all" || direction === "unpinned" || direction === "others" && item !== leaf
            || direction === "left" && position < index || direction === "right" && position > index));
}

/** Content owns document tab menus and save-before-close behavior. */
export function installDocumentTabs(plugin) {
    const { app } = plugin;
    const operations = new DocumentTabActions(plugin);
    const docs = new Map();
    const menus = new Set();
    const closing = new Set();
    const closeTabs = async (leaf, direction) => {
        const group = leaf.parent;
        if (closing.has(group)) return;
        closing.add(group);
        try {
            const targets = direction === "current" ? [leaf] : documentTabsToClose(leaf, direction);
            for (const target of targets) {
                const skipPinned = !["all", "current"].includes(direction);
                if (target.parent !== group || skipPinned && target.pinned) continue;
                try {
                    const doc = target.view.containerEl.ownerDocument;
                    const path = target.view.file?.path;
                    // Flush pending editor writes before detaching each tab.
                    await target.view.save?.();
                    operations.validate(target, doc, path);
                    if (target.parent === group && !(skipPinned && target.pinned)) target.detach();
                } catch { new Notice("A tab could not be saved and was left open."); }
            }
        } finally { closing.delete(group); }
    };
    const attach = (doc) => {
        const context = (event) => {
            const tab = event.target.closest?.(".mod-root .workspace-tab-header");
            if (!tab) return;
            let leaf;
            app.workspace.iterateAllLeaves((item) => { if (item.tabHeaderEl === tab) leaf = item; });
            if (!leaf) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            const menu = new Menu();
            menu.dom.classList.add("pw-document-tab-context-menu");
            menus.add(menu);
            menu.onHide(() => menus.delete(menu));
            const path = leaf.view.file?.path;
            const run = action => { void Promise.resolve().then(() => {
                operations.validate(leaf, doc, path);
                return action();
            }).catch(error => new Notice(error.message ?? "Could not complete the tab action.")); };
            menu.addItem((item) => item.setTitle("Close").setDisabled(closing.has(leaf.parent)).onClick(() => run(() => closeTabs(leaf, "current"))));
            for (const [direction, title] of [["others", "Close Others"], ["all", "Close All"], ["unpinned", "Close All Unpinned"], ["left", "Close Left"], ["right", "Close Right"]]) {
                menu.addItem((item) => item.setTitle(title).setDisabled(closing.has(leaf.parent) || !documentTabsToClose(leaf, direction).length)
                    .onClick(() => run(() => closeTabs(leaf, direction))));
            }
            appendDocumentTabActions(menu, leaf, operations, run);
            menu.showAtMouseEvent(event);
        };
        doc.addEventListener("contextmenu", context, true);
        docs.set(doc, () => {
            doc.removeEventListener("contextmenu", context, true);
        });
    };
    const sync = () => {
        const current = new Set([app.workspace.containerEl.ownerDocument]);
        app.workspace.iterateAllLeaves((leaf) => current.add(leaf.view.containerEl.ownerDocument));
        for (const [doc, remove] of docs) if (!current.has(doc) || doc.defaultView.closed) { remove(); docs.delete(doc); }
        for (const doc of current) if (!docs.has(doc) && !doc.defaultView.closed) attach(doc);
    };
    plugin.registerEvent(app.workspace.on("layout-change", sync));
    plugin.registerEvent(app.workspace.on("window-open", sync));
    app.workspace.onLayoutReady(sync);
    plugin.register(() => { for (const remove of docs.values()) remove(); docs.clear(); for (const menu of menus) menu.hide(); });
}
