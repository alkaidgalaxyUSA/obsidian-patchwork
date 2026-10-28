import { Menu, Notice, Platform, TFile } from "obsidian";

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
    return siblings.filter((item, position) => !item.pinned
        && (direction === "all" || direction === "left" && position < index || direction === "right" && position > index));
}

/** Plain explorer clicks open or focus a document tab; modified clicks stay native. */
export function installDocumentTabs(plugin) {
    const { app } = plugin;
    const docs = new Map();
    const menus = new Set();
    const opening = new Set();
    const closing = new Set();
    const closeTabs = async (leaf, direction) => {
        const group = leaf.parent;
        if (closing.has(group)) return;
        closing.add(group);
        try {
            for (const target of documentTabsToClose(leaf, direction)) {
                if (target.parent !== group || target.pinned) continue;
                try {
                    // Flush pending editor writes before detaching each tab.
                    await target.view.save?.();
                    if (target.parent === group && !target.pinned) target.detach();
                } catch { new Notice("A tab could not be saved and was left open."); }
            }
        } finally { closing.delete(group); }
    };
    const attach = (doc) => {
        const click = (event) => {
            if (!plugin.settings.explorerOpenInNewTab || event.defaultPrevented || event.button !== 0
                || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
            const row = event.target.closest?.('.workspace-leaf-content[data-type="file-explorer"] .nav-file-title[data-path]');
            if (!row || row.classList.contains("is-being-renamed") || event.target.closest("input")) return;
            const file = app.vault.getAbstractFileByPath(row.dataset.path);
            if (!(file instanceof TFile)) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            let existing;
            app.workspace.iterateAllLeaves((leaf) => {
                if (leaf.view.file === file && leaf.view.containerEl.closest(".mod-root")) existing ??= leaf;
            });
            if (existing) { void activateDocumentTab(app, existing); return; }
            if (opening.has(file)) return;
            opening.add(file);
            void app.workspace.getLeaf("tab").openFile(file).catch(() => new Notice("Could not open the file."))
                .finally(() => opening.delete(file));
        };
        const context = (event) => {
            const tab = event.target.closest?.(".mod-root .workspace-tab-header");
            if (!tab) return;
            let leaf;
            app.workspace.iterateAllLeaves((item) => { if (item.tabHeaderEl === tab) leaf = item; });
            if (!leaf) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            const menu = new Menu();
            menus.add(menu);
            menu.onHide(() => menus.delete(menu));
            menu.addItem((item) => item.setTitle("Close").onClick(() => leaf.detach()));
            for (const [direction, title] of [["all", "Close All"], ["left", "Close Left"], ["right", "Close Right"]]) {
                menu.addItem((item) => item.setTitle(title).setDisabled(closing.has(leaf.parent) || !documentTabsToClose(leaf, direction).length)
                    .onClick(() => closeTabs(leaf, direction)));
            }
            menu.addSeparator();
            const file = leaf.view.file;
            if (file) {
                menu.addItem((item) => item.setTitle("Rename").onClick(() => app.fileManager.promptForFileRename(file)));
                if (Platform.isDesktopApp) menu.addItem((item) => item.setTitle("Open in explorer").onClick(() => app.showInFolder(file.path)));
            }
            if (leaf.canPin()) menu.addItem((item) => item.setTitle(leaf.pinned ? "Unpin" : "Pin").onClick(() => leaf.togglePinned()));
            menu.showAtMouseEvent(event);
        };
        doc.addEventListener("click", click, true);
        doc.addEventListener("contextmenu", context, true);
        docs.set(doc, () => {
            doc.removeEventListener("click", click, true);
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
