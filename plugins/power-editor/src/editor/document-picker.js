import { FuzzySuggestModal, Notice } from "obsidian";

/** Search document paths or previously visited editor locations. */
export class DocumentPicker extends FuzzySuggestModal {
    constructor(app, title, items, choose) {
        super(app);
        this.items = items;
        this.choose = choose;
        this.setPlaceholder(title);
        this.setInstructions([{ command: "Enter", purpose: "Open" }, { command: "Esc", purpose: "Cancel" }]);
        this.modalEl.classList.add("pw-document-picker");
    }

    getItems() { return this.items; }
    getItemText(item) { return `${item.label} ${item.path} ${item.line ? `Line ${item.line}` : ""}`; }

    renderSuggestion(match, el) {
        const item = match.item;
        el.createDiv({ cls: "suggestion-title", text: item.label });
        el.createDiv({ cls: "suggestion-note", text: `${item.path}${item.line ? ` · Line ${item.line}` : ""}` });
    }

    onChooseItem(item) {
        void Promise.resolve().then(() => this.choose(item)).catch(error => new Notice(`Could not open document: ${error.message}`));
    }
}
