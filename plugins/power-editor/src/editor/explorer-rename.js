import { Modal, Notice } from "obsidian";

/** Edit the full name while initially selecting only the filename stem. */
export function showExplorerRename(app, file) {
    const modal = new Modal(app);
    modal.setTitle("Rename");
    const form = modal.contentEl.createEl("form", { cls: "pw-explorer-create-form" });
    const input = form.createEl("input", { type: "text", value: file.name, attr: { "aria-label": "Name", autocomplete: "off" } });
    const actions = form.createDiv({ cls: "modal-button-container" });
    const cancel = actions.createEl("button", { text: "Cancel", attr: { type: "button" } });
    cancel.addEventListener("click", () => modal.close());
    const submit = actions.createEl("button", { text: "Rename", cls: "mod-cta", attr: { type: "submit" } });
    form.addEventListener("submit", async event => {
        event.preventDefault();
        if (input.disabled) return;
        const name = input.value.trim();
        if (!name || /[<>:"/\\|?*\x00-\x1f]/.test(name) || /[. ]$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) {
            new Notice("Enter a valid file or folder name."); return;
        }
        if (name === file.name) { modal.close(); return; }
        const path = `${file.parent?.parent ? `${file.parent.path}/` : ""}${name}`;
        const existing = app.vault.getAbstractFileByPath(path);
        if (existing && existing !== file) { new Notice("A file or folder with this name already exists."); return; }
        input.disabled = submit.disabled = true;
        try {
            await app.fileManager.renameFile(file, path);
            modal.close();
        } catch (error) {
            new Notice(`Could not rename selection: ${error.message}`);
        } finally {
            input.disabled = submit.disabled = false;
            if (input.isConnected) input.focus();
        }
    });
    input.addEventListener("keydown", event => {
        if (event.key === "Enter" && event.isComposing) event.preventDefault();
    });
    modal.open();
    input.focus();
    const suffix = file.extension ? `.${file.extension}` : "";
    input.setSelectionRange(0, suffix && file.name.endsWith(suffix) ? file.name.length - suffix.length : file.name.length);
    return modal;
}
