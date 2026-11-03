import { randomUUID } from "node:crypto";
import { GitTaskModal } from "./ui/task-modal";
import { confirm } from "./dialogs";

export class GitResetModal extends GitTaskModal {
    constructor(controller, revision = "HEAD") { super(controller, "Reset HEAD"); this.revision = revision; }
    onOpen() {
        super.onOpen(); this.target = this.field("Target revision", this.revision);
        this.mode = "mixed";
        const modes = this.body.createEl("fieldset", { cls: "pw-git-reset-modes" });
        modes.createEl("legend", { text: "Reset type" });
        const name = `reset-${randomUUID()}`;
        for (const [value, title, description] of [
            ["soft", "Soft", "Keep staged changes and working files."],
            ["mixed", "Mixed", "Unstage changes and keep working files."],
            ["hard", "Hard", "Reset staged changes and working files. Requires a clean working tree."],
            ["keep", "Keep", "Keep local changes; refuse changes that overlap the target."],
        ]) {
            const label = modes.createEl("label", { cls: "pw-git-reset-mode" });
            const radio = label.createEl("input", { attr: { type: "radio", name, value } });
            radio.checked = value === this.mode;
            radio.onchange = () => { if (radio.checked) { this.mode = value; this.updateActions(); } };
            this.controls.push(radio);
            const text = label.createDiv(); text.createSpan({ text: title });
            text.createDiv({ cls: "pw-git-reset-description", text: description });
        }
        this.body.createDiv({ cls: "pw-git-task-help", text: "A backup ref retains the previous HEAD. Hard reset requires a clean working tree; stash changes first." });
        this.resetButton = this.button("Reset…", () => this.reset(), true);
        this.target.oninput = () => this.updateActions();
        this.button("Refresh", () => this.load());
        this.updateActions();
        void this.perform(() => this.load());
    }
    async load() {
        this.clean = !(await this.repo.status()).length;
        this.validate(); this.loaded = true;
        this.status.setText(this.clean ? "Working tree is clean." : "Local changes exist. Hard reset is unavailable until they are committed or stashed.");
    }
    updateActions() {
        const reason = !this.loaded ? "Refresh repository state before resetting."
            : !this.target.value.trim() ? "Enter a target revision."
            : this.controller.operation ? "Finish or abort the active Git operation first."
            : this.mode === "hard" && !this.clean ? "Commit or stash local changes, then refresh." : "";
        this.resetButton.disabled = this.pending || !!reason;
        this.resetButton.title = reason;
    }
    async reset() {
        const target = (await this.repo.run(["rev-parse", "--verify", "--end-of-options", `${this.target.value.trim()}^{commit}`])).trim();
        const head = await this.repo.head(), branch = await this.repo.branch(), mode = this.mode;
        if (!await confirm(this.controller, "Reset branch", `Reset ${branch} to ${target.slice(0, 12)} using ${mode} mode?`, "Reset")) return;
        await this.change(async () => {
            await this.repo.assertNoOperation();
            if (await this.repo.head() !== head || await this.repo.branch() !== branch) throw new Error("The current branch changed. Reopen Reset.");
            if (mode === "hard" && (await this.repo.status()).length) throw new Error("Commit or stash all local changes before Hard reset.");
            this.backup = `refs/patchwork/backups/${randomUUID()}`;
            if (head) await this.repo.run(["update-ref", this.backup, head]);
            await this.repo.run(["reset", `--${mode}`, target, "--"]);
        }); this.status.setText(`Reset completed. Previous HEAD: ${this.backup}`);
    }
}
