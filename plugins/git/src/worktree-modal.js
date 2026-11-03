import { shell } from "electron";
import { resolve } from "node:path";
import { GitTaskModal } from "./ui/task-modal";
import { confirm } from "./dialogs";
import { refNameError } from "./utils/ref-name";

export class GitWorktreeModal extends GitTaskModal {
    constructor(controller) { super(controller, "Git Worktrees"); }
    onOpen() {
        super.onOpen();
        this.directory = this.field("New absolute directory");
        this.branch = this.field("New branch");
        this.start = this.field("Starting revision", "HEAD");
        this.createButton = this.button("Create", async () => {
            const directory = this.directory.value.trim(), branch = this.branch.value.trim();
            if (!directory || !/^(?:[a-z]:[\\/]|\/|\\\\)/i.test(directory)) throw new Error("Enter an absolute worktree directory.");
            await this.change(async () => {
                await this.repo.run(["check-ref-format", "--branch", branch]);
                if (branch.startsWith("-")) throw new Error("Enter a valid branch.");
                const ref = (await this.repo.run(["rev-parse", "--verify", "--end-of-options", `${this.start.value.trim()}^{commit}`])).trim();
                await this.repo.run(["worktree", "add", "-b", branch, "--", directory, ref]);
            }); await this.load();
        }, true);
        for (const field of [this.directory, this.branch, this.start]) field.oninput = () => this.updateActions();
        this.updateActions();
        this.button("Refresh", () => this.load());
        this.button("Prune…", async () => {
            const preview = await this.repo.run(["worktree", "prune", "--dry-run", "--verbose"]);
            if (!await confirm(this.controller, "Prune worktree records", preview || "Prune stale administrative records for worktrees that no longer exist?", "Prune")) return;
            await this.change(() => this.repo.run(["worktree", "prune"])); await this.load();
        });
        this.list = this.body.createDiv({ cls: "pw-git-manager-list" });
        void this.perform(() => this.load());
    }
    updateActions() {
        const reason = !/^(?:[a-z]:[\\/]|\/|\\\\)/i.test(this.directory.value.trim()) ? "Enter an absolute worktree directory."
            : refNameError(this.branch.value.trim()) || (!this.start.value.trim() ? "Enter a starting revision." : "")
                || (!this.existingBranches ? "Refresh branches before creating a worktree." : this.existingBranches.has(this.branch.value.trim()) ? "This branch already exists. Enter a new branch name." : "");
        this.createButton.disabled = this.pending || !!reason;
        this.createButton.title = reason;
    }
    async load() {
        const [raw, snapshot] = await Promise.all([this.repo.run(["worktree", "list", "--porcelain", "-z"]), this.repo.snapshot()]);
        this.validate(); this.list.empty(); this.existingBranches = new Set(snapshot.local);
        for (const block of raw.split("\0\0").filter(Boolean)) {
            const fields = block.split("\0"), path = fields.find(line => line.startsWith("worktree "))?.slice(9);
            if (!path) continue;
            const locked = fields.some(line => line === "locked" || line.startsWith("locked "));
            const branch = fields.find(line => line.startsWith("branch "))?.slice(7) || "Detached HEAD";
            const row = this.list.createDiv({ cls: "pw-git-manager-row" });
            row.createSpan({ text: `${path} · ${branch}${locked ? " · locked" : ""}` });
            this.button("Open Folder", async () => { const error = await shell.openPath(path); if (error) throw new Error(error); this.status.setText("Folder opened."); }, false, row);
            if (resolve(path).toLowerCase() === resolve(this.root).toLowerCase()) continue;
            this.button(locked ? "Unlock" : "Lock", async () => { await this.change(() => this.repo.run(["worktree", locked ? "unlock" : "lock", "--", path])); await this.load(); }, false, row);
            const remove = this.button("Remove…", async () => {
                if (!await confirm(this.controller, "Remove worktree", `Remove ${path}? Git will refuse locked or dirty worktrees.`, "Remove")) return;
                await this.change(() => this.repo.run(["worktree", "remove", "--", path])); await this.load();
            }, false, row);
            remove.disabled = locked;
            remove.title = locked ? "Unlock this worktree before removing it." : "";
        }
        this.status.setText("Removal never forces deletion of a dirty or locked worktree.");
    }
}
