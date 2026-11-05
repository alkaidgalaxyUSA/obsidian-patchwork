import { Notice } from "obsidian";
import { lstatSync, realpathSync } from "node:fs";
import { basename, isAbsolute, relative, resolve } from "node:path";
import { getServiceRegistry } from "../../../utils/service-registry";
import { getWindowContext, resolveWindow } from "../../../utils/windows";
import { choose, confirm } from "../dialogs";

/** File actions also support vault files that Obsidian does not index. */
export class CommitFileActions {
    constructor(controller, paths, document) {
        this.controller = controller;
        this.paths = [...paths];
        this.root = controller.repository.root;
        this.context = getWindowContext(document);
        this.groupLeafId = getServiceRegistry(controller.app).get("content")?.getDocument(this.context).location?.leafId;
    }

    validate() {
        if (this.controller.disposed || this.controller.repository.root !== this.root
            || resolveWindow(this.context.windowId)?.document !== this.context.document) {
            throw new Error("The repository or document window changed. Open the menu again.");
        }
    }

    target(path) {
        const absolute = resolve(this.root, path);
        const repositoryPath = relative(this.root, absolute);
        const vaultPath = relative(this.controller.repository.vaultPath, absolute);
        if ([repositoryPath, vaultPath].some(value => !value || isAbsolute(value) || value === ".." || value.startsWith(`..\\`) || value.startsWith("../"))) {
            throw new Error("Only files inside this vault and repository are supported.");
        }
        return { absolute, path: vaultPath.replaceAll("\\", "/") };
    }

    existing(path) {
        try {
            const target = this.target(path);
            if (!lstatSync(target.absolute).isFile()) return undefined;
            const real = relative(realpathSync(this.controller.repository.vaultPath), realpathSync(target.absolute));
            if (isAbsolute(real) || real === ".." || real.startsWith("../") || real.startsWith(`..\\`)) return undefined;
            return target;
        } catch { return undefined; }
    }

    async run(action) {
        try { this.validate(); await action(); }
        catch (error) { new Notice(error.message ?? "The file action failed."); }
    }

    open() {
        return this.run(async () => {
            const target = this.paths.length === 1 && this.existing(this.paths[0]);
            if (!target) throw new Error("The source file is no longer available.");
            const content = getServiceRegistry(this.controller.app).get("content");
            if (!content) throw new Error("Enable Patchwork Editor to open the source file.");
            await content.openDocument({ ...this.context, path: target.path, target: "new-tab", groupLeafId: this.groupLeafId, focus: true });
            this.validate();
        });
    }

    copy() {
        return this.run(async () => {
            const targets = this.paths.map(path => this.target(path));
            const choice = await choose(this.controller, "Copy Path/Reference...", [
                { name: "Absolute Path", value: "absolute" },
                { name: "Path from Repository Root", value: "repository" },
                { name: "Path from Vault Root", value: "vault" },
                { name: "File Name", value: "name" },
            ]);
            if (!choice) return;
            this.validate();
            const formats = {
                absolute: target => target.absolute,
                repository: target => relative(this.root, target.absolute).replaceAll("\\", "/"),
                vault: target => target.path,
                name: target => basename(target.absolute),
            };
            const text = targets.map(formats[choice.value]).join("\n");
            await this.context.document.defaultView.navigator.clipboard.writeText(text);
            this.validate();
            new Notice("Copied to clipboard.");
        });
    }

    delete() {
        return this.run(async () => {
            if (!this.paths.length || this.controller.busy) return;
            if (this.paths.some(path => !this.existing(path))) throw new Error("A selected file is no longer available.");
            if (!await confirm(this.controller, "Delete files", `Move ${this.paths.length} selected file(s) to trash?`, "Delete")) return;
            this.validate();
            await this.controller.act(async () => {
                for (const path of this.paths) {
                    this.validate();
                    const target = this.existing(path);
                    if (!target) throw new Error("A selected file changed before deletion.");
                    const file = this.controller.app.vault.getFileByPath(target.path);
                    if (file) await this.controller.app.fileManager.trashFile(file);
                    else if (!await this.controller.app.vault.adapter.trashSystem(target.path)) {
                        await this.controller.app.vault.adapter.trashLocal(target.path);
                    }
                    this.validate();
                }
            });
        });
    }

    addToVcs() {
        return this.run(() => this.controller.act(async () => {
            this.validate();
            const entries = await this.controller.repository.status();
            this.validate();
            const paths = entries.filter(entry => entry.untracked && this.paths.includes(entry.path)).map(entry => entry.path);
            if (!paths.length) throw new Error("The selected files are no longer unversioned.");
            await this.controller.repository.stage(paths);
        }));
    }
}
