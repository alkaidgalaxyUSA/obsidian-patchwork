import { CommitFileActions } from "./file-actions";

/** Operation recovery stays visible until Git has cleared its native state. */
export class OperationPanel {
    constructor(controller, parent) {
        this.controller = controller;
        this.el = parent.createDiv({ cls: "pw-git-operation" });
    }

    render() {
        const controller = this.controller;
        const operation = controller.operation;
        const conflicts = controller.entries.filter(entry => entry.conflict);
        this.el.hidden = !operation && !conflicts.length;
        this.el.empty();
        if (this.el.hidden) return;
        this.el.createEl("strong", { text: operation ? `${operation.kind} in progress` : "Unresolved conflicts" });
        this.el.createDiv({ cls: "pw-git-operation-help", text: conflicts.length
            ? "Resolve each file in the editor, then mark it resolved. Deleted files can be marked resolved to keep their deletion."
            : operation?.kind === "rebase" ? "Review staged changes or amend the stopped commit, then Continue. Abort restores the original branch."
                : "Review staged changes, then Continue to finish the operation." });
        const action = (parent, text, callback, disabled = false) => {
            const button = parent.createEl("button", { text, attr: { type: "button" } });
            button.disabled = controller.busy || disabled;
            button.onclick = () => void callback();
        };
        for (const entry of conflicts) {
            const row = this.el.createDiv({ cls: "pw-git-conflict-row" });
            row.createSpan({ text: entry.path, attr: { title: entry.path } });
            const files = new CommitFileActions(controller, [entry.path], this.el.ownerDocument);
            action(row, "Open", () => files.open(), !files.existing(entry.path));
            action(row, "Merge…", () => controller.resolveConflict(entry.path), !files.existing(entry.path));
            action(row, "Mark resolved", () => controller.markResolved(entry.path));
        }
        if (!operation) return;
        const actions = this.el.createDiv({ cls: "pw-git-operation-actions" });
        if (operation.kind === "sequencer") {
            actions.setText("Finish this operation using Git in a terminal.");
            return;
        }
        if (operation.kind === "rebase" && operation.editing) action(actions, "Amend stopped commit…", () => controller.amendRebase(), !!conflicts.length);
        action(actions, "Continue", () => controller.resumeOperation("continue"), !!conflicts.length);
        if (["rebase", "am"].includes(operation.kind)) action(actions, "Skip commit…", () => controller.resumeOperation("skip"));
        action(actions, "Abort…", () => controller.resumeOperation("abort"));
    }
}
