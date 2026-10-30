import { Modal, SuggestModal } from "obsidian";

export function choose(app, title, choices) {
    return new Promise(resolve => {
        const modal = new SuggestModal(app);
        modal.setPlaceholder(title);
        modal.getSuggestions = query => choices.filter(choice => choice.name.toLowerCase().includes(query.toLowerCase()));
        modal.renderSuggestion = (choice, element) => element.setText(choice.name);
        modal.onChooseSuggestion = choice => resolve(choice);
        const onClose = modal.onClose.bind(modal);
        modal.onClose = () => { onClose(); queueMicrotask(() => resolve(undefined)); };
        modal.open();
    });
}

export function prompt(app, title, label, initial = "") {
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
        modal.open(); input.focus(); input.select();
    });
}

export function confirm(app, title, description, action) {
    return new Promise(resolve => {
        const modal = new Modal(app);
        modal.setTitle(title);
        modal.contentEl.createEl("p", { text: description });
        const buttons = modal.contentEl.createDiv({ cls: "modal-button-container" });
        buttons.createEl("button", { text: "Cancel" }).onclick = () => modal.close();
        buttons.createEl("button", { text: action, cls: "mod-warning" }).onclick = () => { resolve(true); modal.close(); };
        modal.onClose = () => resolve(false);
        modal.open();
    });
}

export function showOutput(app, title, text) {
    const modal = new Modal(app);
    modal.setTitle(title);
    modal.modalEl.classList.add("pw-git-output-modal");
    modal.contentEl.createEl("pre", { cls: "pw-git-output", text: text || "No changes." });
    modal.open();
}
