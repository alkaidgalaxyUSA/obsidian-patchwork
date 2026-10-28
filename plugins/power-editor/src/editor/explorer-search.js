import { TFolder } from "obsidian";

/** Search on demand, keeping decrypted text out of persistent indexes and caches. */
export function installExplorerSearch(plugin, view) {
    const { app } = plugin;
    const component = view.search.searchComponent;
    const originalChange = component.changeCallback;
    const originalPlaceholder = component.inputEl.placeholder;
    component.inputEl.placeholder = "Search names and contents...";
    const status = component.containerEl.createDiv({ cls: "pw-explorer-search-status", attr: { role: "status" } });
    component.containerEl.after(status);
    status.hidden = true;
    let revision = 0;
    let timer;
    let disposed = false;
    let folds;
    const restoreFolds = () => {
        if (!folds) return;
        for (const [path, collapsed] of folds) view.fileItems[path]?.setCollapsed?.(collapsed, false);
        folds = undefined;
    };
    const run = async (query, token) => {
        const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
        if (!words.length) {
            view.searchQuery = null;
            view.tree.setSearchFilter(null);
            restoreFolds();
            status.hidden = true;
            return;
        }
        status.hidden = false;
        status.textContent = "Searching...";
        if (!folds) folds = new Map(Object.values(view.fileItems).filter((item) => item.file instanceof TFolder)
            .map((item) => [item.file.path, item.collapsed]));
        const matches = new Set();
        const open = new Map();
        app.workspace.iterateAllLeaves(({ view: current }) => { if (current.file) open.set(current.file.path, current); });
        const files = app.vault.getFiles();
        let index = 0;
        let locked = 0;
        let skipped = 0;
        const worker = async () => {
            while (index < files.length && !disposed && token === revision) {
                const file = files[index++];
                if (!view.fileItems[file.path]?.shouldDisplay()
                    || plugin.settings.hideAttachmentFolders && file.path.split("/").slice(0, -1).includes("assets")) continue;
                const name = file.path.toLocaleLowerCase();
                if (words.every((word) => name.includes(word))) { matches.add(file.path); continue; }
                let text = "";
                const current = open.get(file.path);
                const encrypted = ["mdenc", "encrypted"].includes(file.extension);
                try {
                    if (encrypted) {
                        if (current?.getViewType() !== "meld-encrypted-view" || current.isUnlocking || !current.isSavingEnabled) { locked++; continue; }
                        text = current.getUnencryptedViewData();
                    } else {
                        const type = app.viewRegistry.typeByExtension[file.extension];
                        if (!["md", "canvas", "txt"].includes(file.extension) && type !== "code-editor") continue;
                        if (file.stat.size > 5 * 1024 * 1024) { skipped++; continue; }
                        text = current?.getViewData?.() ?? await app.vault.cachedRead(file);
                    }
                    const searchable = `${name}\n${text.toLocaleLowerCase()}`;
                    if (words.every((word) => searchable.includes(word))) matches.add(file.path);
                } catch { skipped++; }
            }
        };
        await Promise.all(Array.from({ length: 4 }, worker));
        if (disposed || token !== revision) return;
        view.searchQuery = null;
        view.tree.setSearchFilter((item) => !(item.file instanceof TFolder) && item.shouldDisplay() && matches.has(item.file.path));
        for (const path of matches) {
            let folder = app.vault.getAbstractFileByPath(path)?.parent;
            while (folder?.parent) { view.fileItems[folder.path]?.setCollapsed?.(false, false); folder = folder.parent; }
        }
        status.textContent = `${matches.size} matching files${locked ? ` · ${locked} locked notes not searched` : ""}${skipped ? ` · ${skipped} unreadable or large files skipped` : ""}`;
    };
    const change = (query) => {
        clearTimeout(timer);
        const token = ++revision;
        timer = setTimeout(() => { void run(query, token).catch(() => {
            if (!disposed && token === revision) status.textContent = "Search failed. Please try again.";
        }); }, query.trim() ? 180 : 0);
    };
    component.onChange(change);
    const refresh = () => { const query = component.getValue(); if (query.trim()) change(query); };
    const refs = [
        ...["create", "modify", "delete", "rename"].map((event) => [app.vault, app.vault.on(event, refresh)]),
        ...["editor-change", "layout-change", "file-open"].map((event) => [app.workspace, app.workspace.on(event, refresh)]),
    ];
    return () => {
        disposed = true;
        revision++;
        clearTimeout(timer);
        refs.forEach(([emitter, ref]) => emitter.offref(ref));
        if (component.changeCallback === change) component.changeCallback = originalChange;
        component.inputEl.placeholder = originalPlaceholder;
        view.tree.setSearchFilter(null);
        restoreFolds();
        status.remove();
    };
}
