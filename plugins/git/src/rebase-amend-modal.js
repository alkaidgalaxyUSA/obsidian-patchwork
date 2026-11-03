import { GitTaskModal } from "./ui/task-modal";
import { confirm } from "./dialogs";

/** Amend only the native rebase edit stop, using the real staged index. */
export class GitRebaseAmendModal extends GitTaskModal {
    constructor(controller) { super(controller, "Amend Stopped Commit"); this.operation = controller.operation; }
    onOpen() {
        super.onOpen();
        this.body.createDiv({ cls: "pw-git-task-help", text: "Amend the stopped commit with all staged changes and this message. Unstaged changes are excluded. Continue rebase separately after reviewing the result." });
        const label = this.body.createEl("label", { cls: "pw-git-rebase-message" });
        label.createSpan({ text: "Commit message" });
        this.message = label.createEl("textarea", { attr: { rows: "8", "aria-label": "Commit message", spellcheck: "false" } });
        this.controls.push(this.message);
        this.amendButton = this.button("Amend…", () => this.amend(), true);
        this.message.oninput = () => this.updateActions();
        this.updateActions();
        void this.perform(async () => {
            await this.controller.operations.validate(this.operation);
            const message = await this.repo.run(["log", "-1", "--format=%B"]);
            await this.controller.operations.validate(this.operation);
            this.validate(); this.message.value = message; this.loaded = true;
            this.status.setText("Review the complete message and staged changes before amending.");
        });
    }
    updateActions() {
        this.amendButton.disabled = this.pending || !this.loaded || !this.message.value.trim();
        this.amendButton.title = !this.loaded ? "Load the stopped commit first." : !this.message.value.trim() ? "Enter a commit message." : "";
    }
    async amend() {
        const message = this.message.value;
        if (!await confirm(this.controller, "Amend stopped commit", "Replace the stopped commit with this message and all staged changes?", "Amend")) return;
        const checks = { checkWhitespace: this.controller.plugin.settingsStore.preferences.checkWhitespace === true };
        await this.change(() => this.controller.operations.amend(this.operation, message, checks));
        this.close();
    }
}
