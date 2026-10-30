import { Notice, TFile } from "obsidian";

async function openExplorerFileForEditing(app, file) {
    let leaf;
    app.workspace.iterateAllLeaves(candidate => {
        if (candidate.view.file === file && candidate.view.containerEl.closest(".mod-root")) leaf ??= candidate;
    });
    leaf ??= app.workspace.getLeaf("tab");
    await leaf.openFile(file, { active: true, state: { mode: "source" } });
    // Apply after opening: the reading-mode policy handles new document sessions.
    if (typeof leaf.view.getMode === "function") {
        await leaf.view.setState({ ...leaf.view.getState(), mode: "source" }, { history: false });
    }
    app.workspace.setActiveLeaf(leaf, { focus: true });
    leaf.view.editor?.focus();
}

async function reloadExplorerFileFromDisk(app, file) {
    const views = [];
    app.workspace.iterateAllLeaves(leaf => { if (leaf.view.file === file) views.push(leaf.view); });
    if (views.some(view => view.saving || view.isSavingInProgress)) {
        throw new Error("The file is being saved. Try again when saving finishes.");
    }
    // Preserve unsaved plaintext before replacing it with the disk version.
    for (const view of views) {
        if (!view.dirty || !["markdown", "code-editor"].includes(view.getViewType())) continue;
        await app.fileManager.storeTextFileBackup(file.path, view.getViewData());
    }
    if (!views.length) {
        const type = app.viewRegistry.typeByExtension[file.extension];
        if (type === "markdown" || type === "code-editor") await app.vault.read(file);
        else await app.vault.readBinary(file);
        return;
    }
    for (const view of views) {
        if (view.file !== file) continue;
        if (view.saving || view.isSavingInProgress) throw new Error("The file is being saved. Try again when saving finishes.");
        if (["markdown", "code-editor"].includes(view.getViewType()) && typeof view.loadFileInternal === "function") {
            await view.loadFileInternal(file, true);
            view.dirty = false;
            view.saveAgain = false;
        } else await view.onLoadFile(file);
    }
}

/** Customize native explorer menus without replacing other plugins' actions. */
export function installExplorerFileMenus(plugin) {
    const { app } = plugin;
    const running = new Set();
    const run = async (file, action) => {
        if (running.has(file)) return;
        running.add(file);
        try { await action(); }
        catch (error) { new Notice(error.message ?? "Could not complete the file action."); }
        finally { running.delete(file); }
    };
    plugin.registerEvent(app.workspace.on("file-menu", (menu, file, source) => {
        if (source !== "file-explorer-context-menu") return;
        const copyText = text => run(file, () => app.workspace.containerEl.ownerDocument.defaultView.navigator.clipboard.writeText(text));
        for (const item of menu.items) {
            const title = item.titleEl?.textContent?.trim().toLowerCase();
            if (title === "show in system explorer") item.setTitle("Open in explorer");
            if (title === "make a copy" || title === "duplicate") {
                item.setTitle("Copy").setIcon("copy").onClick(() => copyText(file.name));
            }
        }
        menu.addItem(item => item.setSection("action").setTitle("Copy Path").setIcon("copy")
            .onClick(() => copyText(app.vault.adapter.getFullPath(file.path))));
        if (!(file instanceof TFile)) return;
        menu.addItem(item => item.setSection("open").setTitle("Open and Edit").setIcon("pencil")
            .onClick(() => run(file, () => openExplorerFileForEditing(app, file))));
        menu.addItem(item => item.setSection("action").setTitle("Local History").setIcon("history").onClick(() => {
            const recovery = app.internalPlugins.plugins["file-recovery"];
            if (!recovery?.enabled) { new Notice("Enable File recovery to view local history."); return; }
            recovery.instance.openModal(file.path);
        }));
        menu.addItem(item => item.setSection("action").setTitle("Reload from Disk").setIcon("refresh-cw")
            .onClick(() => run(file, () => reloadExplorerFileFromDisk(app, file))));
    }));
}
