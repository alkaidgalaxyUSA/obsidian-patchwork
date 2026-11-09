import { Modal } from "obsidian";
import { renderDiff } from "../history/utils/render-diff";

/** Read-only historical comparison, independent of workspace editor tabs. */
export class CommitDiffModal extends Modal {
    constructor(app, document, title, raw, files, mode) {
        super(app);
        this.document = document;
        this.raw = raw;
        this.files = files;
        this.mode = mode === "unified" ? "unified" : "split";
        this.setTitle(title);
        this.modalEl.classList.add("pw-commit-diff-modal");
    }

    onOpen() {
        if (this.modalEl.ownerDocument !== this.document) {
            this.close();
            throw new Error("Open the comparison from the active window.");
        }
        this.contentEl.classList.add("pw-git-diff-view");
        const toolbar = this.contentEl.createDiv({ cls: "pw-git-diff-actions" });
        this.buttons = new Map();
        for (const [mode, label] of [["split", "Side by Side"], ["unified", "Unified"]]) {
            const button = toolbar.createEl("button", { text: label, attr: { type: "button" } });
            button.onclick = () => { this.mode = mode; this.render(); };
            this.buttons.set(mode, button);
        }
        for (const [direction, label] of [[-1, "Previous Change"], [1, "Next Change"]]) {
            const button = toolbar.createEl("button", { text: label, attr: { type: "button" } });
            button.onclick = () => this.navigate(direction);
        }
        const close = toolbar.createEl("button", { text: "Close", attr: { type: "button" } });
        close.onclick = () => this.close();
        this.output = this.contentEl.createEl("pre", { cls: "pw-git-output", attr: { tabindex: "0" } });
        this.output.onkeydown = event => {
            if (event.key !== "F7") return;
            event.preventDefault(); this.navigate(event.shiftKey ? -1 : 1);
        };
        this.render();
    }

    render() {
        this.output.empty(); this.index = -1;
        for (const [mode, button] of this.buttons) button.setAttribute("aria-pressed", String(mode === this.mode));
        renderDiff(this.output, this.raw, this.files, this.mode);
    }

    navigate(direction) {
        const hunks = this.output.querySelectorAll(".pw-diff-hunk");
        if (!hunks.length) return;
        this.index = this.index < 0 ? (direction > 0 ? 0 : hunks.length - 1) : (this.index + direction + hunks.length) % hunks.length;
        hunks[this.index].scrollIntoView({ block: "center" });
        hunks[this.index].focus({ preventScroll: true });
    }

    onClose() { this.contentEl.empty(); }
}
