import { TFolder, normalizePath } from "obsidian";

/** Keep file operations separate from the system's text clipboard. */
export class ExplorerFileClipboard {
    constructor(app) { this.app = app; this.entries = []; }

    capture(files, cut) {
        this.entries = files.filter(file => file.parent && !files.some(parent => parent !== file
            && parent instanceof TFolder && file.path.startsWith(`${parent.path}/`)));
        this.cut = cut;
    }

    async paste(folder) {
        const { vault, fileManager } = this.app;
        const entries = this.entries.filter(file => vault.getAbstractFileByPath(file.path) === file);
        if (entries.some(file => file === folder || file instanceof TFolder && folder.path.startsWith(`${file.path}/`))) {
            throw new Error("Cannot paste a directory into itself.");
        }
        for (const file of entries) {
            if (this.cut && file.parent === folder) continue;
            let index = 0;
            let destination;
            do {
                const suffix = index++ ? ` (${index - 1})` : "";
                const name = file instanceof TFolder ? `${file.name}${suffix}` : `${file.basename}${suffix}${file.extension ? `.${file.extension}` : ""}`;
                destination = normalizePath(`${folder.parent ? `${folder.path}/` : ""}${name}`);
            } while (vault.getAbstractFileByPath(destination));
            if (this.cut) await fileManager.renameFile(file, destination);
            else await this.copy(file, destination);
            if (this.cut) this.entries = this.entries.filter(entry => entry !== file);
        }
    }

    async copy(file, destination) {
        if (!(file instanceof TFolder)) return this.app.vault.copy(file, destination);
        await this.app.vault.createFolder(destination);
        for (const child of [...file.children]) await this.copy(child, `${destination}/${child.name}`);
    }
}
