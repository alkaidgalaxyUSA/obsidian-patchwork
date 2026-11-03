import { installExplorerTree } from "./explorer-tree";
import { canEnhanceExplorer, hideExplorerSearch } from "../utils/native-explorer";
import { getServiceRegistry } from "../../../utils/service-registry";
import { getWindowContext } from "../../../utils/windows";
import { Menu, Notice, TFile, TFolder } from "obsidian";
import { setIcon } from "../utils/icons";
import { createDocumentMenu, createExplorerMenu, createMarkdown, showCreateDialog } from "./explorer-menus.js";
import { installExplorerSearch } from "./explorer-search.js";
import { expandExplorerSelection, installExplorerSelection } from "./explorer-selection.js";
import { installExplorerFileMenus } from "./explorer-file-actions.js";
import { openProjectDocument } from "./document-open";
import { scopeModule } from "../../../utils/module-scope";

/** Own only the file-list controls; keep native tree and sorting implementations. */
export function installExplorerActions(plugin, runtime) {
    if (plugin.disposeExplorerActions) return;
    const workspace = plugin.app.workspace;
    const doc = workspace.containerEl.ownerDocument;
    const entries = new Map();
    const searchReturns = new Map();
    const dialogs = new Set();
    installExplorerFileMenus(plugin, runtime.menus);
    const nativeFiles = new Map();
    const rememberDocument = leaf => {
        if (leaf?.view.file instanceof TFile) nativeFiles.set(leaf.view.containerEl.ownerDocument, leaf.view.file.path);
    };
    rememberDocument(workspace.activeLeaf);
    const selectedDocument = (document = doc) => {
        const content = getServiceRegistry(plugin.app).get("content");
        const snapshot = content?.getDocument(getWindowContext(document));
        const path = snapshot?.location?.path ?? nativeFiles.get(document);
        const file = path && plugin.app.vault.getAbstractFileByPath(path);
        return file instanceof TFile ? file : undefined;
    };
    let disposed = false;
    let pending = false;
    let restoringExplorer = false;
    let restoreFailed = false;
    let wasCollapsed = false;
    let menu;
    let menuAnchor;
    let selectedFolder;
    const creationFolder = () => {
        if (selectedFolder && plugin.app.vault.getAbstractFileByPath(selectedFolder.path) === selectedFolder) return selectedFolder;
        const file = selectedDocument();
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
        const borders = getServiceRegistry(plugin.app).get("borders");
        if (!borders) { new Notice("Enable Borders to hide the Project panel."); return; }
        borders.hidePanel("project", getWindowContext(doc));
    };
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
        if (entry.controls.includes(menuAnchor)) closeMenu();
        entry.enabled = false;
        entry.disposeSearch();
        entry.restoreSearch();
        entry.treeControls?.dispose();
        entry.disposeSelection();
        entry.releaseView();
        entry.view.containerEl.removeEventListener("click", entry.selectFolder, true);
        entry.view.containerEl.ownerDocument.removeEventListener("pointerover", entry.suppressTooltip, true);
        entry.controls.forEach((el) => el.remove());
        if (entry.nativeCollapse && entry.nativeCollapse.style.getPropertyValue("display") === "none"
            && entry.nativeCollapse.style.getPropertyPriority("display") === "important") {
            if (entry.collapseDisplay) entry.nativeCollapse.style.setProperty("display", entry.collapseDisplay, entry.collapsePriority);
            else entry.nativeCollapse.style.removeProperty("display");
        }
        if (!entry.hadControls) entry.view.containerEl.classList.remove("pw-explorer-controls");
        if (entry.view.getSortedFolderItems === entry.sorted) {
            if (entry.sortDescriptor) Object.defineProperty(entry.view, "getSortedFolderItems", entry.sortDescriptor);
            else delete entry.view.getSortedFolderItems;
        }
        entry.view.sort();
    };
    const attach = (leaf, host) => {
        const view = leaf.view;
        if (!canEnhanceExplorer(view)) return;
        const entry = { view, host, controls: [], originalSort: view.getSortedFolderItems,
            sortDescriptor: Object.getOwnPropertyDescriptor(view, "getSortedFolderItems"), enabled: true,
            hadControls: view.containerEl.classList.contains("pw-explorer-controls"), releaseView: runtime.registerView(view) };
        entry.selectFolder = (event) => {
            const row = event.target.closest?.(".nav-folder-title[data-path], .nav-file-title[data-path]");
            if (!row) return;
            const file = plugin.app.vault.getAbstractFileByPath(row.dataset.path);
            selectedFolder = file instanceof TFolder ? file : file?.parent;
        };
        view.containerEl.addEventListener("click", entry.selectFolder, true);
        entry.disposeSelection = installExplorerSelection(view, () => runtime.selectionChanged(view), (file, event) => {
            const modified = event.ctrlKey || event.metaKey;
            void openProjectDocument(plugin.app, file, getWindowContext(view.containerEl.ownerDocument), modified ? "new-tab" : "reuse", undefined, !modified)
                .catch(error => new Notice(error.message));
        });
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
            const original = entry.originalSort.call(this, folder);
            if (!entry.enabled) return original;
            const sorted = original.filter((item) => !plugin.settings.hideAttachmentFolders
                || !(item.file instanceof TFolder) || item.file.name !== "assets");
            if (!plugin.settings.explorerFilesFirst) return sorted;
            return [...sorted.filter((item) => !(item.file instanceof TFolder)), ...sorted.filter((item) => item.file instanceof TFolder)];
        };
        view.getSortedFolderItems = entry.sorted;
        view.containerEl.classList.add("pw-explorer-controls");
        entry.treeControls = installExplorerTree(plugin, view, runtime);
        const project = button("Project", "chevron-down", () => openMenu(project, () => {
            const choices = new Menu();
            const scope = scopeModule(choices.dom, "project", { surface: "view-menu" });
            choices.onHide(() => { scope.dispose(); project.setAttribute("aria-expanded", "false"); });
            choices.addItem(item => item.setTitle("Project").onClick(() => project.focus()));
            project.setAttribute("aria-expanded", "true");
            return choices;
        }));
        project.classList.add("pw-project-view-selector");
        project.setAttribute("aria-haspopup", "menu");
        project.setAttribute("aria-expanded", "false");
        project.prepend(doc.createTextNode("Project"));
        const create = button("New", "explorer-create", () => openMenu(create, () => {
            const folder = creationFolder();
            return createDocumentMenu(plugin.app, view, (ext, label) => {
                if (ext === "md") return createMarkdown(plugin.app, folder);
                const dialog = showCreateDialog(plugin.app, view, ext, label, folder);
                dialogs.add(dialog);
                const closeDialog = dialog.onClose.bind(dialog);
                dialog.onClose = () => { dialogs.delete(dialog); closeDialog(); };
            }, folder);
        }));
        create.classList.add("pw-explorer-create");
        const divider = doc.createElement("span");
        divider.className = "pw-explorer-divider";
        divider.setAttribute("aria-hidden", "true");
        const select = button("Select Opened File", "select-opened-file", () => {
            const file = selectedDocument();
            if (!file) { new Notice("No document tab is open."); return; }
            const reveal = () => {
                if (disposed) return;
                const item = view.fileItems[file.path];
                if (!item) return;
                view.revealInFolder(file);
                view.tree.infinityScroll.invalidateAll();
                view.tree.clearSelectedDoms();
                view.tree.selectItem(item);
                view.tree.setFocusedItem(item, false);
                view.tree.activeDom = item;
            };
            const search = view.search.searchComponent;
            if (search.getValue().trim()) {
                search.setValue("");
                search.changeCallback?.("");
                // Let the search restore its folds before revealing the requested file.
                doc.defaultView.setTimeout(reveal, 0);
                return;
            }
            reveal();
        });
        const expand = button("Expand Select", "git-expand-all", () => {
            entry.treeControls.expand();
            void expandExplorerSelection(view).catch(error => new Notice(`Could not expand selection: ${error.message}`));
        });
        entry.restoreSearch = hideExplorerSearch(view);
        entry.disposeSearch = installExplorerSearch(plugin, view);
        const more = button("More options", "explorer-more", () => openMenu(more, () => createExplorerMenu(plugin, view, update)));
        more.classList.add("pw-explorer-more");
        const minimize = button("Hide files", "explorer-minimize", toggleCollapsed);
        minimize.classList.add("pw-explorer-minimize");
        // Keep Collapse fixed; native state updates may still change the hidden control.
        host.prepend(project, create, divider, select);
        host.append(more, minimize);
        const collapse = button("Collapse All", "git-collapse-all", () => {
            view.tree.isAllCollapsed = false;
            view.tree.setCollapseAll(true);
            entry.treeControls.collapse();
        });
        entry.nativeCollapse = view.collapseOrExpandAllEl;
        if (entry.nativeCollapse) {
            entry.collapseDisplay = entry.nativeCollapse.style.getPropertyValue("display");
            entry.collapsePriority = entry.nativeCollapse.style.getPropertyPriority("display");
            entry.nativeCollapse.style.setProperty("display", "none", "important");
        }
        const nativeAnchor = entry.nativeCollapse?.parentElement === host ? entry.nativeCollapse : more;
        host.insertBefore(expand, nativeAnchor);
        host.insertBefore(collapse, nativeAnchor);
        entry.controls.push(project, create, divider, select, expand, collapse, more, minimize);
        entries.set(leaf, entry);
        view.sort();
    };
    const sync = () => {
        if (disposed) return;
        const dock = workspace.leftSplit?.containerEl;
        if (!workspace.layoutReady || !dock) return;
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
            scopeModule(back, "project");
            row.prepend(back);
            searchReturns.set(leaf, back);
        }
        const collapsed = leaves.length > 0 && workspace.leftSplit.collapsed;
        if (collapsed && !wasCollapsed) for (const { view } of leaves) {
            view.tree.isAllCollapsed = false; view.tree.setCollapseAll(true);
        }
        wasCollapsed = collapsed;
        for (const { view } of entries.values()) view.containerEl.setAttribute("data-pw-compact", String(!!plugin.settings.explorerCompact));
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
            if (!getServiceRegistry(plugin.app).get("borders") && tabs.children[tabs.currentTab] !== leaf) tabs.selectTab(leaf);
            const host = leaf.view.containerEl.querySelector(".nav-buttons-container");
            if (host) attach(leaf, host);
        }
    };
    const schedule = () => {
        if (disposed || pending) return;
        pending = true;
        queueMicrotask(() => { pending = false; sync(); });
    };
    // Register teardown before layout callbacks can run or initialization can fail.
    const dispose = () => {
        if (disposed) return;
        disposed = true;
        closeMenu();
        for (const dialog of dialogs) dialog.close();
        for (const entry of entries.values()) restore(entry);
        entries.clear();
        for (const back of searchReturns.values()) back.remove();
        searchReturns.clear();
        nativeFiles.clear();
        if (plugin.disposeExplorerActions === dispose) delete plugin.disposeExplorerActions;
    };
    plugin.disposeExplorerActions = dispose;
    plugin.register(dispose);
    plugin.registerEvent(workspace.on("layout-change", schedule));
    plugin.registerEvent(workspace.on("active-leaf-change", leaf => { rememberDocument(leaf); schedule(); }));
    plugin.registerEvent(workspace.on("file-open", () => { rememberDocument(workspace.activeLeaf); selectedFolder = undefined; }));
    workspace.onLayoutReady(schedule);
}
