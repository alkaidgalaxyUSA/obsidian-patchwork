import { Notice, TFile, TFolder } from "obsidian";
import { setIcon } from "../../../utils/icons";
import { createDocumentMenu, createExplorerMenu, createMarkdown, showCreateDialog } from "./explorer-menus.js";
import { installExplorerSearch } from "./explorer-search.js";
import { expandExplorerSelection, installExplorerSelection } from "./explorer-selection.js";

/** Own only the file-list controls; keep native tree and sorting implementations. */
export function installExplorerActions(plugin) {
    const workspace = plugin.app.workspace;
    const doc = workspace.containerEl.ownerDocument;
    const entries = new Map();
    const searchReturns = new Map();
    const dialogs = new Set();
    let disposed = false;
    let pending = false;
    let restoringExplorer = false;
    let restoreFailed = false;
    let restoredCollapsed = false;
    let wasCollapsed = false;
    let menu;
    let menuAnchor;
    let selectedFolder;
    const creationFolder = () => {
        if (selectedFolder && plugin.app.vault.getAbstractFileByPath(selectedFolder.path) === selectedFolder) return selectedFolder;
        const file = workspace.getActiveFile() ?? workspace.getMostRecentLeaf()?.view.file;
        return file?.parent ?? plugin.app.vault.getRoot();
    };
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
        if (workspace.leftSplit.collapsed) workspace.leftSplit.expand();
        else workspace.leftSplit.collapse();
        update("explorerCollapsed", workspace.leftSplit.collapsed);
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
        entry.disposeSearch();
        entry.disposeSelection();
        entry.view.containerEl.removeEventListener("click", entry.selectFolder, true);
        entry.view.containerEl.ownerDocument.removeEventListener("pointerover", entry.suppressTooltip, true);
        entry.controls.forEach((el) => el.remove());
        entry.view.containerEl.classList.remove("pw-explorer-controls");
        if (entry.view.getSortedFolderItems === entry.sorted) entry.view.getSortedFolderItems = entry.originalSort;
        entry.view.sort();
    };
    const attach = (leaf, host) => {
        const view = leaf.view;
        const entry = { view, host, controls: [], originalSort: view.getSortedFolderItems };
        entry.selectFolder = (event) => {
            const row = event.target.closest?.(".nav-folder-title[data-path], .nav-file-title[data-path]");
            if (!row) return;
            const file = plugin.app.vault.getAbstractFileByPath(row.dataset.path);
            selectedFolder = file instanceof TFolder ? file : file?.parent;
        };
        view.containerEl.addEventListener("click", entry.selectFolder, true);
        entry.disposeSelection = installExplorerSelection(view);
        entry.suppressTooltip = (event) => {
            const row = event.target.closest?.(".nav-file-title, .nav-folder-title");
            if (!row || !view.containerEl.contains(row) || event.pointerType === "touch") return;
            // Skip native date/count tooltips, while retaining modifier-key link previews.
            event.stopPropagation();
            if (event.relatedTarget && row.contains(event.relatedTarget)) return;
            const file = plugin.app.vault.getAbstractFileByPath(row.dataset.path);
            if (file instanceof TFile) workspace.trigger("hover-link", {
                event, source: "file-explorer", hoverParent: view, targetEl: row, linktext: file.path,
            });
        };
        view.containerEl.ownerDocument.addEventListener("pointerover", entry.suppressTooltip, true);
        entry.sorted = function (folder) {
            const sorted = entry.originalSort.call(this, folder).filter((item) => !plugin.settings.hideAttachmentFolders
                || !(item.file instanceof TFolder) || item.file.name !== "assets");
            if (!plugin.settings.explorerFilesFirst) return sorted;
            return [...sorted.filter((item) => !(item.file instanceof TFolder)), ...sorted.filter((item) => item.file instanceof TFolder)];
        };
        view.getSortedFolderItems = entry.sorted;
        view.containerEl.classList.add("pw-explorer-controls");
        const create = button("New", "explorer-create", () => openMenu(create, () => {
            const folder = creationFolder();
            return createDocumentMenu(plugin.app, view, (ext, label) => {
                if (ext === "md") return createMarkdown(plugin.app, folder);
                const dialog = showCreateDialog(plugin.app, view, ext, label, folder);
                dialogs.add(dialog);
                dialog.onClose = () => { dialogs.delete(dialog); dialog.contentEl.empty(); };
            }, folder);
        }));
        create.classList.add("pw-explorer-create");
        const divider = doc.createElement("span");
        divider.className = "pw-explorer-divider";
        divider.setAttribute("aria-hidden", "true");
        const select = button("Select Opened File", "select-opened-file", () => {
            const file = workspace.getActiveFile() ?? workspace.getMostRecentLeaf()?.view.file;
            if (file) view.revealInFolder(file);
        });
        const expand = button("Expand Select", "chevrons-up-down", () => {
            void expandExplorerSelection(view).catch(error => new Notice(`Could not expand selection: ${error.message}`));
        });
        view.search.hide();
        entry.disposeSearch = installExplorerSearch(plugin, view);
        const more = button("More options", "explorer-more", () => openMenu(more, () => createExplorerMenu(plugin, view, update)));
        more.classList.add("pw-explorer-more");
        const minimize = button("Hide files", "explorer-minimize", toggleCollapsed);
        minimize.classList.add("pw-explorer-minimize");
        // Keep the native collapse/expand action, including its changing icon and label.
        host.prepend(create, divider, select);
        host.append(more, minimize);
        const collapse = host.querySelector(".nav-action-button:has(.lucide-chevrons-down-up, .lucide-chevrons-up-down)");
        host.insertBefore(expand, collapse ?? more);
        entry.controls.push(create, divider, select, expand, more, minimize);
        entries.set(leaf, entry);
        view.sort();
    };
    const sync = () => {
        if (disposed) return;
        const explorers = workspace.getLeavesOfType("file-explorer");
        // Pinning existing tabs is not enough: a restored layout or native tab
        // close can leave only Search in the sidebar. Restore Files via Obsidian,
        // keeping the existing Search leaf and its native implementation intact.
        if (!explorers.length && workspace.layoutReady && plugin.app.internalPlugins.plugins["file-explorer"]?.enabled
            && !restoringExplorer && !restoreFailed) {
            restoringExplorer = true;
            void workspace.ensureSideLeaf("file-explorer", "left", { reveal: false }).catch(() => {
                restoreFailed = true;
                if (!disposed) new Notice("Could not restore Files. Use the Open files command to retry.");
            }).finally(() => {
                restoringExplorer = false;
                if (!workspace.getLeavesOfType("file-explorer").length) restoreFailed = true;
                schedule();
            });
        }
        if (explorers.length) restoreFailed = false;
        const leaves = explorers
            .filter((leaf) => workspace.leftSplit.containerEl.contains(leaf.view.containerEl));
        const searchLeaves = workspace.getLeavesOfType("search")
            .filter((leaf) => workspace.leftSplit.containerEl.contains(leaf.view.containerEl));
        for (const [leaf, back] of searchReturns) {
            if (searchLeaves.includes(leaf) && back.isConnected) continue;
            back.remove();
            searchReturns.delete(leaf);
        }
        for (const leaf of searchLeaves) {
            if (searchReturns.has(leaf)) continue;
            const row = leaf.view.containerEl.querySelector(".search-row");
            if (!row) continue;
            const back = button("Back to files", "folder", () => plugin.app.commands.executeCommandById("file-explorer:open"));
            back.classList.add("pw-search-back-to-files");
            row.prepend(back);
            searchReturns.set(leaf, back);
        }
        if (leaves.length && !restoredCollapsed) {
            restoredCollapsed = true;
            if (plugin.settings.explorerCollapsed) workspace.leftSplit.collapse();
        }
        const collapsed = leaves.length > 0 && workspace.leftSplit.collapsed;
        if (collapsed && !wasCollapsed) {
            for (const { view } of leaves) {
                // Reset on every close, including Project and native sidebar controls.
                view.tree.isAllCollapsed = false;
                view.tree.setCollapseAll(true);
            }
        }
        wasCollapsed = collapsed;
        if (leaves.length && !!plugin.settings.explorerCollapsed !== collapsed) {
            plugin.settings.explorerCollapsed = collapsed;
            save();
        }
        doc.body.classList.toggle("pw-file-explorer-pinned", leaves.length > 0);
        doc.body.classList.toggle("pw-file-explorer-collapsed", collapsed);
        doc.body.classList.toggle("pw-file-explorer-compact", !!plugin.settings.explorerCompact);
        rail.hidden = !collapsed;
        for (const [leaf, entry] of entries) {
            if (leaves.includes(leaf) && entry.host.isConnected) continue;
            restore(entry);
            entries.delete(leaf);
        }
        for (const leaf of leaves) {
            // Select Files when attaching/restoring it, not on every layout event:
            // otherwise the native global-search command is immediately overridden.
            if (entries.has(leaf)) continue;
            const tabs = leaf.parent;
            if (tabs.children[tabs.currentTab] !== leaf) tabs.selectTab(leaf);
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
    plugin.registerEvent(workspace.on("file-open", () => { selectedFolder = undefined; }));
    const dockObserver = new doc.defaultView.MutationObserver(schedule);
    dockObserver.observe(workspace.leftSplit.containerEl, { attributes: true, attributeFilter: ["class", "style"] });
    workspace.onLayoutReady(schedule);
    plugin.register(() => {
        disposed = true;
        dockObserver.disconnect();
        closeMenu();
        for (const dialog of dialogs) dialog.close();
        for (const entry of entries.values()) restore(entry);
        entries.clear();
        for (const back of searchReturns.values()) back.remove();
        searchReturns.clear();
        rail.remove();
        doc.body.classList.remove("pw-file-explorer-pinned", "pw-file-explorer-collapsed", "pw-file-explorer-compact");
        if (plugin.settings.explorerCollapsed) workspace.leftSplit.expand();
    });
}
