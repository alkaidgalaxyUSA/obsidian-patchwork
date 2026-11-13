import { Notice } from "obsidian";
import { scopeModule } from "../../../utils/module-scope";
import { GitTaskModal } from "../ui/task-modal";
import { openGitDialog } from "../utils/portals";
import { rewordCommit, undoReword, validateReword } from "../utils/reword-commit";

export function showCommitNotification(controller, record) {
    if (controller.disposed) return;
    controller.commitNotice?.dispose();
    const doc = controller.app.workspace.containerEl.ownerDocument;
    const fragment = doc.createDocumentFragment();
    const root = doc.createElement("div");
    fragment.append(root);
    root.className = "pw-git-commit-notification";
    root.createEl("strong", { text: record.warning ? "Commit completed with warnings" : record.previous ? "Commit message updated" : `${record.count} ${record.count === 1 ? "file" : "files"} committed` });
    root.createDiv({ cls: "pw-git-notification-message", text: record.message || "" });
    if (record.warning) root.createDiv({ text: record.warning });
    const actions = root.createDiv({ cls: "pw-git-notification-actions" });
    const scope = scopeModule(root, "git", { surface: "notification" });
    const notice = new Notice(fragment, 0);
    let disposed = false;
    const dispose = () => { if (disposed) return; disposed = true; clearTimeout(timer); scope.dispose(); notice.hide(); };
    const timer = setTimeout(dispose, 20000);
    controller.commitNotice = { root: record.root, hash: record.hash, dispose };
    const button = (label, callback) => {
        const el = actions.createEl("button", { text: label, attr: { type: "button" } });
        el.onclick = event => { event.stopPropagation(); if (!disposed) callback(); };
    };
    if (record.hash) button("Edit Commit Message…", () => { dispose(); openGitDialog(controller, new EditCommitMessageModal(controller, record)); });
    if (record.previous) button("Undo", () => {
        dispose();
        void controller.act(async () => { await undoReword(controller, record); new Notice("Commit message edit undone."); });
    });
}

export class EditCommitMessageModal extends GitTaskModal {
    constructor(controller, record) { super(controller, "Edit Commit Message"); this.record = record; }
    onOpen() {
        super.onOpen();
        this.modalEl.classList.add("pw-git-reword-modal");
        this.body.createEl("label", { text: `Commit ${this.record.hash.slice(0, 8)}`, attr: { for: "pw-git-reword-message" } });
        this.message = this.body.createEl("textarea", { attr: { id: "pw-git-reword-message", rows: "7", spellcheck: "false" } });
        this.message.value = this.record.message;
        this.controls.push(this.message);
        this.saveButton = this.button("Save", async () => {
            let result;
            await this.change(async () => { result = await rewordCommit(this.controller, this.record, this.message.value); });
            this.close(); showCommitNotification(this.controller, result);
        }, true);
        this.message.oninput = () => this.updateActions();
        this.valid = false;
        void this.perform(async () => { await validateReword(this.controller, this.record.root, this.record.hash, this.record.branch); this.valid = true; })
            .then(() => { if (!this.closed) this.message.focus(); });
    }
    updateActions() { if (this.saveButton) this.saveButton.disabled = this.pending || !this.valid || !this.message.value.trim(); }
}
