import { access, lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { join, relative, isAbsolute } from "node:path";
import { randomUUID } from "node:crypto";
import { GitTaskModal } from "./ui/task-modal";

/** Three index stages and an explicit resolution; never writes an open editor's file. */
export class GitConflictModal extends GitTaskModal {
    constructor(controller, path) { super(controller, `Resolve Conflict: ${path}`); this.path = path; }
    onOpen() {
        super.onOpen(); this.modalEl.classList.add("pw-git-conflict-modal");
        this.body.createDiv({ cls: "pw-git-task-help", text: "Stage 2 and Stage 3 follow Git's index order; during rebase, Stage 2 is the upstream side. Save the resolution only after closing this file's editor tabs." });
        const sides = this.body.createDiv({ cls: "pw-git-conflict-sides" });
        this.versions = [];
        for (const title of ["Base · Stage 1", "Stage 2 · Ours", "Stage 3 · Theirs"]) {
            const label = sides.createEl("label", { text: title });
            this.versions.push(label.createEl("textarea", { attr: { readonly: "", "aria-label": title, spellcheck: "false" } }));
        }
        const label = this.body.createEl("label", { cls: "pw-git-resolution", text: "Result" });
        this.result = label.createEl("textarea", { attr: { "aria-label": "Merge result", spellcheck: "false" } });
        this.controls.push(this.result);
        this.button("Use Stage 2", () => this.use(1));
        this.button("Use Stage 3", () => this.use(2));
        this.button("Save and Mark Resolved", () => this.save(), true);
        void this.perform(() => this.load());
    }
    decode(bytes) {
        if (bytes.includes(0) || !Buffer.from(bytes.toString("utf8"), "utf8").equals(bytes)) throw new Error("Use the file's native editor for binary or non-UTF-8 conflicts, then Mark resolved.");
        if (bytes.length > 2 * 1024 * 1024) throw new Error("This conflict is too large for the merge dialog. Resolve it in the file editor.");
        return bytes.toString("utf8");
    }
    async validatePath(absolute) {
        const path = relative(await realpath(this.root), await realpath(absolute));
        if (isAbsolute(path) || path === ".." || path.startsWith("../") || path.startsWith("..\\")) throw new Error("The file resolves outside the repository.");
        if (!(await lstat(absolute)).isFile()) throw new Error("Only regular files can be merged here.");
    }
    async load() {
        this.file = this.controller.sourceFile(this.path);
        if (!this.file || this.file.extension.toLowerCase() === "mdenc") throw new Error("Only existing, unencrypted vault files can be merged here. Use the owning editor for other files, then Mark resolved.");
        const absolute = join(this.root, this.path);
        await this.validatePath(absolute);
        await access(absolute, constants.W_OK);
        this.operation = await this.controller.operations.state();
        this.index = await this.repo.run(["ls-files", "--unmerged", "-z", "--", this.path]);
        if (!this.index) throw new Error("This file is no longer conflicted.");
        this.original = await readFile(absolute);
        this.originalText = this.decode(this.original);
        this.stageTexts = [];
        for (let stage = 1; stage <= 3; stage++) {
            const record = this.index.split("\0").find(record => record.split("\t")[0].endsWith(` ${stage}`));
            if (!record) { this.stageTexts.push(undefined); continue; }
            const hash = record.split(" ")[1];
            this.stageTexts.push(this.decode(await this.repo.run(["cat-file", "blob", hash], { encoding: "buffer" })));
        }
        this.validate();
        this.stageTexts.forEach((text, index) => { this.versions[index].value = text ?? "(File absent on this side)"; });
        this.result.value = this.originalText;
        this.loaded = true;
        this.status.setText("Review or edit the result. An original-byte backup is retained before saving.");
    }
    use(index) {
        if (!this.loaded || this.stageTexts[index] === undefined) throw new Error("This side deleted the file. Delete it in the explorer and mark the deletion resolved instead.");
        this.result.value = this.stageTexts[index];
        this.status.setText("Review the result, then save explicitly.");
    }
    ensureClosed() {
        let opened = false;
        this.app.workspace.iterateAllLeaves(leaf => { if (leaf.view.file?.path === this.file.path) opened = true; });
        if (opened) throw new Error("Close all editor tabs for this file before saving the merge result. This prevents overwriting pending editor saves.");
    }
    async save() {
        if (!this.loaded) throw new Error("The conflict could not be loaded.");
        const result = this.originalText.includes("\r\n") ? this.result.value.replace(/\r?\n/g, "\r\n") : this.result.value;
        if (/^(?:<{7,}|={7,}|>{7,}|\|{7,})(?: |\r?$)/m.test(result)) throw new Error("Remove the remaining conflict markers before saving.");
        await this.change(async () => {
            await this.controller.operations.validate(this.operation);
            this.ensureClosed();
            const absolute = join(this.root, this.path);
            await this.validatePath(absolute);
            await access(absolute, constants.W_OK);
            if (!this.original.equals(await readFile(absolute)) || this.index !== await this.repo.run(["ls-files", "--unmerged", "-z", "--", this.path])) throw new Error("The file or conflict changed. Reopen the conflict to avoid losing edits.");
            const directory = join(this.repo.gitDir, "patchwork-resolution-backups");
            await mkdir(directory, { recursive: true });
            this.backup = join(directory, `${randomUUID()}.original`);
            await writeFile(this.backup, this.original, { flag: "wx" });
            this.validate(); this.ensureClosed();
            await this.app.vault.process(this.file, current => {
                this.validate(); this.ensureClosed();
                if (current !== this.originalText) throw new Error("The file changed while saving. Reopen the conflict.");
                return result;
            });
            try { await this.controller.operations.markResolved(this.operation, this.path); }
            catch (error) { throw new Error(`Resolution saved but not staged: ${error.message}. Original backup: ${this.backup}`); }
        });
        this.loaded = false;
        this.status.setText(`Resolution saved and staged. Original backup: ${this.backup}`);
    }
}
