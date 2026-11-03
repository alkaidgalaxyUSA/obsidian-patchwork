import { isAbsolute, relative, resolve } from "node:path";
import { Repository } from "./repository";
import { GitTaskModal } from "./ui/task-modal";

export class GitRepositoriesModal extends GitTaskModal {
    constructor(controller) { super(controller, "Repository and Submodules"); }
    onOpen() {
        super.onOpen();
        this.path = this.field("Repository directory", this.root);
        this.body.createDiv({ cls: "pw-git-task-help", text: "Choose the vault repository or a nested repository. Commit drafts are saved per repository when switching. Existing dialogs and Diff tabs reject a changed repository." });
        this.selectButton = this.button("Use Repository", () => this.select(), true);
        this.path.oninput = () => this.updateActions();
        this.updateActions();
        this.button("Refresh Submodules", () => this.load());
        this.list = this.body.createDiv({ cls: "pw-git-manager-list" });
        void this.perform(() => this.load());
    }
    updateActions() {
        const valid = isAbsolute(this.path.value.trim());
        this.selectButton.disabled = this.pending || !valid;
        this.selectButton.title = valid ? "" : "Enter an absolute repository directory.";
    }
    async select() {
        const path = this.path.value.trim(); if (!isAbsolute(path)) throw new Error("Enter an absolute directory.");
        const probe = new Repository(path, this.repo.executable);
        try {
            await probe.discover();
            const inside = relative(this.repo.vaultPath, probe.root), parent = relative(probe.root, this.repo.vaultPath);
            const outside = value => isAbsolute(value) || value === ".." || value.startsWith("../") || value.startsWith("..\\");
            if (outside(inside) && outside(parent)) throw new Error("Choose the vault's repository or a repository inside the vault.");
            await this.controller.switchRepository(probe);
            this.close();
        } finally { probe.dispose(); }
    }
    async load() {
        const raw = await this.repo.run(["config", "-z", "--file", ".gitmodules", "--get-regexp", "^submodule\\..*\\.path$"], { allowedExitCodes: [1] });
        this.validate(); this.list.empty();
        for (const record of raw.split("\0").filter(Boolean)) {
            const path = record.slice(record.indexOf("\n") + 1);
            const row = this.list.createDiv({ cls: "pw-git-manager-row" }); row.createSpan({ text: path });
            this.button("Initialize / Update", async () => {
                await this.change(() => this.repo.run(["submodule", "update", "--init", "--recursive", "--", path]));
                this.status.setText(`Submodule updated: ${path}`);
            }, false, row);
            this.button("Open Repository", async () => { this.path.value = resolve(this.root, path); await this.select(); }, false, row);
        }
        this.status.setText(this.list.childElementCount ? "Updates check out the commits recorded by the parent repository." : "No submodules in this repository.");
    }
}
