import { Notice, TFolder } from "obsidian";
import { showExplorerRename } from "./explorer-rename.js";

function explorerSelectionRange(view, anchor, target) {
    const ordered = [];
    const visit = folder => {
        for (const item of view.getSortedFolderItems(folder)) {
            if (item.shouldDisplay?.() === false || view.tree.filter && item.info.hidden) continue;
            ordered.push(item);
            if (item.file instanceof TFolder && !item.collapsed) visit(item.file);
        }
    };
    visit(view.app.vault.getRoot());
    const start = ordered.indexOf(anchor);
    const end = ordered.indexOf(target);
    if (start < 0 || end < 0) return [target];
    return ordered.slice(Math.min(start, end), Math.max(start, end) + 1);
}

/** Select rows without opening them; keep selection in the native tree. */
export function installExplorerSelection(view) {
    const tree = view.tree;
    const originals = new Map();
    const wrappers = new Map();
    let disposed = false;
    let deleting = false;
    let renameDialog;
    let selectionFrame;
    const win = view.containerEl.ownerDocument.defaultView;
    const connectedRows = new Set();
    const updateConnections = () => {
        selectionFrame = undefined;
        if (disposed) return;
        for (const row of connectedRows) row.classList.remove("pw-selection-join-before", "pw-selection-join-after");
        connectedRows.clear();
        const rows = [...view.containerEl.querySelectorAll(".nav-file-title, .nav-folder-title")]
            .map(row => ({ row, bounds: row.getBoundingClientRect() }))
            .filter(({ bounds }) => bounds.height > 0).sort((a, b) => a.bounds.top - b.bounds.top);
        for (let index = 1; index < rows.length; index++) {
            const before = rows[index - 1];
            const after = rows[index];
            if (!before.row.classList.contains("pw-explorer-selected") || !after.row.classList.contains("pw-explorer-selected")) continue;
            if (Math.abs(after.bounds.top - before.bounds.bottom) > 1) continue;
            before.row.classList.add("pw-selection-join-after");
            after.row.classList.add("pw-selection-join-before");
            connectedRows.add(before.row); connectedRows.add(after.row);
        }
    };
    const scheduleConnections = () => {
        if (!disposed && selectionFrame === undefined) selectionFrame = win.requestAnimationFrame(updateConnections);
    };
    view.containerEl.classList.add("pw-explorer-single-selection");
    for (const name of ["selectItem", "deselectItem", "clearSelectedDoms"]) {
        const original = tree[name];
        const wrapper = function (...args) {
            const affected = name === "clearSelectedDoms" ? [...this.selectedDoms] : [args[0]];
            const result = original.apply(this, args);
            for (const item of affected) {
                item?.selfEl.classList.toggle("pw-explorer-selected", this.selectedDoms.has(item));
            }
            scheduleConnections();
            return result;
        };
        originals.set(name, original);
        wrappers.set(name, wrapper);
        tree[name] = wrapper;
    }
    const select = item => {
        if (!item || item === tree.root) return;
        tree.clearSelectedDoms();
        tree.selectItem(item);
        tree.setFocusedItem(item, false);
        tree.activeDom = item;
    };
    if (tree.selectedDoms.size) {
        for (const item of tree.selectedDoms) item.selfEl.classList.add("pw-explorer-selected");
    } else select(tree.focusedItem ?? tree.activeDom);
    const itemAt = event => {
        if (![0, 2].includes(event.button)) return;
        if (event.target.closest?.("input, textarea, [contenteditable=true]")) return;
        const row = event.target.closest?.(".nav-folder-title[data-path], .nav-file-title[data-path]");
        if (!row || !view.containerEl.contains(row) || row.classList.contains("is-being-renamed")) return;
        return view.fileItems[row.dataset.path];
    };
    const click = event => {
        if (event.button !== 0) return;
        const item = itemAt(event);
        if (!item) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (item.file instanceof TFolder && event.target.closest(".collapse-icon")) {
            void item.toggleCollapsed(true);
            return;
        }
        view.app.workspace.setActiveLeaf(view.leaf, { focus: true });
        if (event.shiftKey && tree.activeDom) {
            if (!event.ctrlKey && !event.metaKey) tree.clearSelectedDoms();
            for (const member of explorerSelectionRange(view, tree.activeDom, item)) tree.selectItem(member);
            tree.setFocusedItem(item, false);
            return;
        }
        if (event.ctrlKey || event.metaKey) {
            if (tree.selectedDoms.has(item)) tree.deselectItem(item);
            else tree.selectItem(item);
            tree.setFocusedItem(item, false);
            tree.activeDom = item;
            return;
        }
        select(item);
    };
    const contextmenu = event => {
        const item = itemAt(event);
        if (!item) return;
        view.app.workspace.setActiveLeaf(view.leaf, { focus: true });
        if (!tree.selectedDoms.has(item)) select(item);
        else tree.setFocusedItem(item, false);
    };
    const doubleClick = event => {
        if (event.button !== 0) return;
        const item = itemAt(event);
        if (!item) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.target.closest(".collapse-icon")) return;
        if (item.file instanceof TFolder) {
            void item.toggleCollapsed(true);
            return;
        }
        void view.app.workspace.getLeaf(event.ctrlKey || event.metaKey).openFile(item.file);
    };
    const keydown = event => {
        const target = event.target;
        if (!target?.closest || target.closest("input, textarea, [contenteditable=true], .modal-container, .menu")) return;
        if (!view.containerEl.contains(target) && (view.app.workspace.activeLeaf !== view.leaf || target !== target.ownerDocument.body)) return;
        if (event.isComposing) return;
        if (event.key === "F2" || event.key === "Delete") {
            if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            if (event.repeat || deleting) return;
            const selected = [...tree.selectedDoms];
            if (event.key === "F2") {
                if (selected.length === 1) {
                    renameDialog?.close();
                    renameDialog = showExplorerRename(view.app, selected[0].file);
                }
                else if (selected.length > 1) new Notice("Select one file or folder to rename.");
                return;
            }
            if (!selected.length) return;
            const files = new Set(selected.map(item => item.file));
            const roots = [...files].filter(file => {
                if (file === view.app.vault.getRoot()) return false;
                for (let parent = file.parent; parent; parent = parent.parent) if (files.has(parent)) return false;
                return true;
            });
            deleting = true;
            void (async () => {
                for (const file of roots) {
                    if (view.app.vault.getAbstractFileByPath(file.path) !== file) continue;
                    await view.app.vault.trash(file, view.app.vault.getConfig("trashOption") === "system");
                }
                tree.clearSelectedDoms();
                tree.setFocusedItem(null);
                tree.activeDom = null;
            })().catch(error => new Notice(`Could not delete selection: ${error.message}`))
                .finally(() => { deleting = false; });
            return;
        }
        if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        queueMicrotask(() => {
            if (disposed || event.shiftKey || event.ctrlKey || event.metaKey) return;
            select(tree.focusedItem);
        });
    };
    // Replace the native bindings in their existing scope. A second global
    // shortcut listener can otherwise race the native asynchronous file actions.
    const shortcuts = tree.scope.keys.filter(binding => !binding.modifiers && ["F2", "Delete"].includes(binding.key))
        .map(binding => ({ binding, original: binding.func, handler: event => keydown(event) }));
    for (const shortcut of shortcuts) shortcut.binding.func = shortcut.handler;
    const navigationKeydown = event => {
        if (!["F2", "Delete"].includes(event.key)) keydown(event);
    };
    const collapseDescendants = async folder => {
        const pending = folder.children.filter(child => child instanceof TFolder);
        while (pending.length && !disposed) {
            const child = pending.pop();
            pending.push(...child.children.filter(item => item instanceof TFolder));
            const item = view.fileItems[child.path];
            if (item && !item.collapsed) await item.setCollapsed(true);
        }
    };
    // Observe native folding as well as our mouse actions, including keyboard
    // collapse. Descendants may be detached by the virtualized tree.
    const collapseObserver = new view.containerEl.ownerDocument.defaultView.MutationObserver(records => {
        if (records.some(record => record.type === "childList" || record.target.matches?.(".nav-folder"))) scheduleConnections();
        for (const record of records) {
            if (record.type !== "attributes" || !record.target.matches(".nav-folder.is-collapsed")
                || record.oldValue?.split(/\s+/).includes("is-collapsed")) continue;
            const row = record.target.querySelector(":scope > .nav-folder-title[data-path]");
            const folder = view.fileItems[row?.dataset.path]?.file;
            if (folder instanceof TFolder) {
                void collapseDescendants(folder).catch(() => new Notice("Could not collapse nested folders."));
            }
        }
    });
    collapseObserver.observe(view.containerEl, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"], attributeOldValue: true });
    scheduleConnections();
    view.containerEl.addEventListener("contextmenu", contextmenu, true);
    view.containerEl.addEventListener("scroll", scheduleConnections, true);
    view.containerEl.addEventListener("click", click, true);
    view.containerEl.addEventListener("dblclick", doubleClick, true);
    view.containerEl.ownerDocument.defaultView.addEventListener("keydown", navigationKeydown, true);
    return () => {
        disposed = true;
        renameDialog?.close();
        win.cancelAnimationFrame(selectionFrame);
        for (const row of connectedRows) row.classList.remove("pw-selection-join-before", "pw-selection-join-after");
        collapseObserver.disconnect();
        for (const item of tree.selectedDoms) item.selfEl.classList.remove("pw-explorer-selected");
        for (const [name, original] of originals) if (tree[name] === wrappers.get(name)) tree[name] = original;
        for (const shortcut of shortcuts) if (shortcut.binding.func === shortcut.handler) shortcut.binding.func = shortcut.original;
        view.containerEl.classList.remove("pw-explorer-single-selection");
        view.containerEl.removeEventListener("click", click, true);
        view.containerEl.removeEventListener("contextmenu", contextmenu, true);
        view.containerEl.removeEventListener("scroll", scheduleConnections, true);
        view.containerEl.removeEventListener("dblclick", doubleClick, true);
        view.containerEl.ownerDocument.defaultView.removeEventListener("keydown", navigationKeydown, true);
    };
}

/** Expand the selected branch, or the whole tree when nothing is selected. */
export async function expandExplorerSelection(view) {
    const file = view.tree.focusedItem?.file ?? view.tree.activeDom?.file ?? view.app.vault.getRoot();
    const folder = file instanceof TFolder ? file : file.parent;
    const pending = folder ? [folder] : [];
    while (pending.length) {
        const current = pending.pop();
        await view.fileItems[current.path]?.setCollapsed(false);
        pending.push(...current.children.filter(child => child instanceof TFolder));
    }
}
