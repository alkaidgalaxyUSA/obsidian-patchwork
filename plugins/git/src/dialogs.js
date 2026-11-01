import { Modal, SuggestModal } from "obsidian";
import { openGitDialog } from "./utils/portals";

export function choose(controller, title, choices) {
    if (controller.disposed) return Promise.resolve(undefined);
    const app = controller.app;
    return new Promise(resolve => {
        const modal = new SuggestModal(app);
        modal.setPlaceholder(title);
        modal.getSuggestions = query => choices.filter(choice => choice.name.toLowerCase().includes(query.toLowerCase()));
        modal.renderSuggestion = (choice, element) => element.setText(choice.name);
        modal.onChooseSuggestion = choice => resolve(choice);
        const onClose = modal.onClose.bind(modal);
        modal.onClose = () => { onClose(); queueMicrotask(() => resolve(undefined)); };
        openGitDialog(controller, modal);
    });
}

export function prompt(controller, title, label, initial = "") {
    if (controller.disposed) return Promise.resolve(undefined);
    const app = controller.app;
    return new Promise(resolve => {
        const modal = new Modal(app);
        modal.setTitle(title);
        const form = modal.contentEl.createEl("form", { cls: "pw-git-form" });
        const field = form.createEl("label", { text: label });
        const input = field.createEl("input", { type: "text", value: initial });
        form.createEl("button", { text: "OK", cls: "mod-cta", attr: { type: "submit" } });
        form.addEventListener("submit", event => {
            event.preventDefault();
            if (!input.value.trim()) return;
            resolve(input.value.trim()); modal.close();
        });
        modal.onClose = () => resolve(undefined);
        openGitDialog(controller, modal); input.focus(); input.select();
    });
}

export function confirm(controller, title, description, action) {
    if (controller.disposed) return Promise.resolve(undefined);
    const app = controller.app;
    return new Promise(resolve => {
        const modal = new Modal(app);
        modal.setTitle(title);
        modal.contentEl.createEl("p", { text: description });
        const buttons = modal.contentEl.createDiv({ cls: "modal-button-container" });
        buttons.createEl("button", { text: "Cancel" }).onclick = () => modal.close();
        buttons.createEl("button", { text: action, cls: "mod-warning" }).onclick = () => { resolve(true); modal.close(); };
        modal.onClose = () => resolve(false);
        openGitDialog(controller, modal);
    });
}

export function showOutput(controller, title, text) {
    if (controller.disposed) return;
    const app = controller.app;
    const modal = new Modal(app);
    modal.setTitle(title);
    modal.modalEl.classList.add("pw-git-output-modal");
    modal.contentEl.createEl("pre", { cls: "pw-git-output", text: text || "No changes." });
    openGitDialog(controller, modal);
}
