import { Modal } from "obsidian";
import { getWindowContext, resolveWindow } from "../../../utils/windows";

/** Shared lifetime and error handling for Git's asynchronous dialogs. */
export class GitTaskModal extends Modal {
    constructor(controller, title) {
        super(controller.app);
        this.controller = controller;
        this.repo = controller.repository;
        this.root = this.repo.root;
        this.setTitle(title);
        this.modalEl.classList.add("pw-git-task-modal");
        this.controls = [];
        this.body = this.contentEl.createDiv({ cls: "pw-git-task-body" });
        this.status = this.contentEl.createDiv({ cls: "pw-git-task-status", attr: { role: "status", "aria-live": "polite" } });
        this.actions = this.contentEl.createDiv({ cls: "modal-button-container" });
        this.auxiliaryActions = this.actions.createDiv({ cls: "pw-git-task-auxiliary" });
        this.primaryActions = this.actions.createDiv({ cls: "pw-git-task-primary" });
        this.cancelButton = this.primaryActions.createEl("button", { text: "Cancel", attr: { type: "button" } });
        this.cancelButton.onclick = () => this.cancel();
    }
    onOpen() { this.context = getWindowContext(this.modalEl.ownerDocument); }
    validate() {
        if (this.closed || this.controller.disposed || this.repo.root !== this.root
            || resolveWindow(this.context.windowId)?.document !== this.context.document) throw new Error("The dialog, window or repository changed. Reopen this action.");
    }
    field(label, value = "", options) {
        const row = this.body.createEl("label", { cls: "pw-git-task-field" });
        row.createSpan({ text: label });
        const input = row.createEl(options ? "select" : "input", { attr: { "aria-label": label } });
        if (options) for (const [key, text] of options) input.createEl("option", { value: key, text });
        else { input.type = "text"; input.spellcheck = false; input.autocomplete = "off"; }
        input.value = value; this.controls.push(input); return input;
    }
    cancel() { if (!this.pending) this.close(); }
    button(label, action, primary = false, parent = primary ? this.primaryActions : this.auxiliaryActions) {
        const button = parent.createEl("button", { text: label, cls: primary ? "mod-cta" : "", attr: { type: "button" } });
        button.onclick = () => void this.perform(action);
        this.controls.push(button); return button;
    }
    async perform(action) {
        if (this.pending || this.closed) return;
        this.pending = true;
        this.body.inert = true;
        this.body.setAttribute("aria-busy", "true");
        this.cancelButton.disabled = !this.canCancelPending;
        this.controls = this.controls.filter(control => control.isConnected);
        const states = this.controls.map(control => [control, control.disabled]);
        for (const [control] of states) control.disabled = true;
        this.status.setText("Working…");
        try { this.validate(); await action(); if (!this.closed) this.validate(); }
        catch (error) { if (!this.closed) this.status.setText(error.message); }
        finally {
            this.pending = false;
            this.body.inert = false;
            this.body.removeAttribute("aria-busy");
            this.cancelButton.disabled = false;
            if (!this.closed) {
                if (this.status.textContent === "Working…") this.status.empty();
                for (const [control, disabled] of states) if (control.isConnected) control.disabled = disabled;
                this.updateActions?.();
            }
        }
    }
    async change(action) {
        this.validate();
        return this.controller.act(async () => { this.validate(); return action(); }, true);
    }
    onClose() { this.closed = true; this.controls = []; }
}
