import { Notice, TFolder } from "obsidian";

/** Select text on a single click; keep native keyboard navigation. */
export function installExplorerSelection(view) {
    let selectedItem;
    let disposed = false;
    view.containerEl.classList.add("pw-explorer-single-selection");
    const select = item => {
        if (!item || item === view.tree.root) return;
        selectedItem?.selfEl.classList.remove("pw-explorer-selected");
        selectedItem = item;
        item.selfEl.classList.add("pw-explorer-selected");
        view.tree.clearSelectedDoms();
        view.tree.selectItem(item);
        view.tree.setFocusedItem(item, false);
        view.tree.activeDom = item;
    };
    select(view.tree.focusedItem ?? view.tree.activeDom);
    const itemAt = event => {
        if (event.button !== 0) return;
        if (event.target.closest?.("input, textarea, [contenteditable=true]")) return;
        const row = event.target.closest?.(".nav-folder-title[data-path], .nav-file-title[data-path]");
        if (!row || !view.containerEl.contains(row) || row.classList.contains("is-being-renamed")) return;
        return view.fileItems[row.dataset.path];
    };
    const click = event => {
        const item = itemAt(event);
        if (!item) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (item.file instanceof TFolder && event.target.closest(".collapse-icon")) {
            void item.toggleCollapsed(true);
            return;
        }
        view.app.workspace.setActiveLeaf(view.leaf, { focus: true });
        select(item);
    };
    const doubleClick = event => {
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
        if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        if (event.target.closest?.("input, textarea, [contenteditable=true]")) return;
        queueMicrotask(() => { if (!disposed) select(view.tree.focusedItem); });
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
        for (const record of records) {
            if (!record.target.matches(".nav-folder.is-collapsed")
                || record.oldValue?.split(/\s+/).includes("is-collapsed")) continue;
            const row = record.target.querySelector(":scope > .nav-folder-title[data-path]");
            const folder = view.fileItems[row?.dataset.path]?.file;
            if (folder instanceof TFolder) {
                void collapseDescendants(folder).catch(() => new Notice("Could not collapse nested folders."));
            }
        }
    });
    collapseObserver.observe(view.containerEl, { subtree: true, attributes: true, attributeFilter: ["class"], attributeOldValue: true });
    view.containerEl.addEventListener("click", click, true);
    view.containerEl.addEventListener("dblclick", doubleClick, true);
    view.containerEl.addEventListener("keydown", keydown, true);
    return () => {
        disposed = true;
        collapseObserver.disconnect();
        selectedItem?.selfEl.classList.remove("pw-explorer-selected");
        view.containerEl.classList.remove("pw-explorer-single-selection");
        view.containerEl.removeEventListener("click", click, true);
        view.containerEl.removeEventListener("dblclick", doubleClick, true);
        view.containerEl.removeEventListener("keydown", keydown, true);
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
