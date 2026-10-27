import { Notice, TFolder } from "obsidian";
import { setIcon } from "../../../utils/icons";
import { createDocumentMenu, createExplorerMenu, showCreateDialog } from "./explorer-menus.js";

/** Own only the file-list controls; keep native tree and sorting implementations. */
export function installExplorerActions(plugin) {
    const workspace = plugin.app.workspace;
    const doc = workspace.containerEl.ownerDocument;
    const entries = new Map();
    const dialogs = new Set();
    let disposed = false;
    let pending = false;
    let menu;
    let menuAnchor;
    const button = (label, icon, action) => {
        const el = doc.createElement("button");
        el.type = "button";
        el.className = "clickable-icon nav-action-button";
        el.setAttribute("aria-label", label);
        setIcon(el, icon);
        el.addEventListener("click", action);
        return el;
    };
    const closeMenu = () => { menu?.hide(); menu = undefined; menuAnchor = undefined; };
    const save = () => void plugin.persistSettings().catch(() => new Notice("Could not save file-list preferences."));
    const update = (key, value) => {
        plugin.settings[key] = value;
        save();
        schedule();
        if (key === "explorerFilesFirst") for (const { view } of entries.values()) view.sort();
    };
    const toggleCollapsed = () => {
        closeMenu();
        update("explorerCollapsed", !plugin.settings.explorerCollapsed);
    };
    const rail = doc.createElement("div");
    rail.className = "pw-explorer-rail";
    rail.hidden = true;
    rail.append(button("Show files", "folder", toggleCollapsed));
    doc.body.append(rail);
    const openMenu = (anchor, factory) => {
        if (menu?.dom.isConnected && menuAnchor === anchor) { closeMenu(); return; }
        closeMenu();
        const next = factory();
        next.setParentElement(anchor);
        next.dom.classList.add("pw-explorer-menu");
        next.onHide(() => { if (menu === next) { menu = undefined; menuAnchor = undefined; } });
        menu = next;
        menuAnchor = anchor;
        const bounds = anchor.getBoundingClientRect();
        next.showAtPosition({ x: bounds.left, y: bounds.bottom + 4 });
    };
    const restore = (entry) => {
        entry.controls.forEach((el) => el.remove());
        entry.view.containerEl.classList.remove("pw-explorer-controls");
        if (entry.view.getSortedFolderItems === entry.sorted) entry.view.getSortedFolderItems = entry.originalSort;
        entry.view.sort();
    };
    const attach = (leaf, host) => {
        const view = leaf.view;
        const entry = { view, host, controls: [], originalSort: view.getSortedFolderItems };
        entry.sorted = function (folder) {
            const sorted = entry.originalSort.call(this, folder);
            if (!plugin.settings.explorerFilesFirst) return sorted;
            return [...sorted.filter((item) => !(item.file instanceof TFolder)), ...sorted.filter((item) => item.file instanceof TFolder)];
        };
        view.getSortedFolderItems = entry.sorted;
        view.containerEl.classList.add("pw-explorer-controls");
        const create = button("New", "explorer-create", () => openMenu(create, () => createDocumentMenu(plugin.app, view, (ext, label) => {
            const dialog = showCreateDialog(plugin.app, view, ext, label);
            dialogs.add(dialog);
            dialog.onClose = () => { dialogs.delete(dialog); dialog.contentEl.empty(); };
        })));
        create.classList.add("pw-explorer-create");
        const divider = doc.createElement("span");
        divider.className = "pw-explorer-divider";
        divider.setAttribute("aria-hidden", "true");
        const select = button("Select Opened File", "select-opened-file", () => {
            const file = workspace.getActiveFile() ?? workspace.getMostRecentLeaf()?.view.file;
            if (file) view.revealInFolder(file);
        });
        const more = button("More options", "ellipsis-vertical", () => openMenu(more, () => createExplorerMenu(plugin, view, update)));
        more.classList.add("pw-explorer-more");
        const minimize = button("Hide files", "explorer-minimize", toggleCollapsed);
        minimize.classList.add("pw-explorer-minimize");
        // Keep the native collapse/expand action, including its changing icon and label.
        host.prepend(create, divider, select);
        host.append(more, minimize);
        entry.controls.push(create, divider, select, more, minimize);
        entries.set(leaf, entry);
        view.sort();
    };
    const sync = () => {
        if (disposed) return;
        const leaves = workspace.getLeavesOfType("file-explorer")
            .filter((leaf) => workspace.leftSplit.containerEl.contains(leaf.view.containerEl));
        const collapsed = leaves.length > 0 && !!plugin.settings.explorerCollapsed;
        doc.body.classList.toggle("pw-file-explorer-pinned", leaves.length > 0);
        doc.body.classList.toggle("pw-file-explorer-collapsed", collapsed);
        doc.body.classList.toggle("pw-file-explorer-compact", !!plugin.settings.explorerCompact);
        rail.hidden = !collapsed;
        for (const [leaf, entry] of entries) {
            if (leaves.includes(leaf) && entry.host.isConnected) continue;
            restore(entry);
            entries.delete(leaf);
        }
        if (leaves.length && workspace.leftSplit.collapsed !== collapsed) {
            if (collapsed) workspace.leftSplit.collapse();
            else workspace.leftSplit.expand();
        }
        for (const leaf of leaves) {
            const tabs = leaf.parent;
            if (tabs.children[tabs.currentTab] !== leaf) tabs.selectTab(leaf);
            if (entries.has(leaf)) continue;
            const host = leaf.view.containerEl.querySelector(".nav-buttons-container");
            if (host) attach(leaf, host);
        }
    };
    const schedule = () => {
        if (disposed || pending) return;
        pending = true;
        queueMicrotask(() => { pending = false; sync(); });
    };
    plugin.registerEvent(workspace.on("layout-change", schedule));
    plugin.registerEvent(workspace.on("active-leaf-change", schedule));
    workspace.onLayoutReady(schedule);
    plugin.register(() => {
        disposed = true;
        closeMenu();
        for (const dialog of dialogs) dialog.close();
        for (const entry of entries.values()) restore(entry);
        entries.clear();
        rail.remove();
        doc.body.classList.remove("pw-file-explorer-pinned", "pw-file-explorer-collapsed", "pw-file-explorer-compact");
        if (plugin.settings.explorerCollapsed) workspace.leftSplit.expand();
    });
}
