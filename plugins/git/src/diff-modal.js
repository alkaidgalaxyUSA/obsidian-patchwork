import { Modal, Notice, setIcon } from "obsidian";
import { renderDiff } from "./history/utils/render-diff";
import { scopeModule } from "../../utils/module-scope";

/** Shared read-only Diff surface used by history and revision entry points. */
export class GitDiffModal extends Modal {
    constructor(controller, document, title, raw, files, options = {}) {
        super(controller.app);
        this.controller = controller;
        this.document = document;
        this.title = title;
        this.raw = raw;
        this.files = files;
        this.mode = options.mode === "unified" ? "unified" : "split";
        this.historical = options.historical === true;
        this.revision = options.revision;
        this.setTitle(title);
        this.modalEl.classList.add("pw-git-diff-modal");
    }

    onOpen() {
        if (this.modalEl.ownerDocument !== this.document) { this.close(); return; }
        this.scope = scopeModule(this.modalEl, "git", { surface: "diff" });
        this.contentEl.classList.add("pw-git-diff-view");
        this.render();
    }

    render() {
        this.contentEl.empty();
        const toolbar = this.contentEl.createDiv({ cls: "pw-git-diff-actions" });
        const left = toolbar.createDiv({ cls: "pw-git-diff-actions-left" });
        const center = toolbar.createDiv({ cls: "pw-git-diff-actions-center" });
        const right = toolbar.createDiv({ cls: "pw-git-diff-actions-right" });
        const button = (host, icon, label, action, selected = false) => {
            const el = host.createEl("button", { attr: { type: "button", "aria-label": label, "aria-pressed": String(selected) } });
            setIcon(el, icon); el.title = label; el.onclick = action; return el;
        };
        const separator = host => host.createSpan({ cls: "pw-git-diff-separator", text: "|", attr: { "aria-hidden": "true" } });
        button(left, "arrow-up", "Previous Difference", () => this.navigate(-1));
        button(left, "arrow-down", "Next Difference", () => this.navigate(1));
        button(left, "edit", "Jump to Source", () => this.jumpToSource());
        separator(left);
        button(left, "chevron-left", "Previous File", () => this.navigateFile(-1));
        center.createSpan({ cls: "pw-git-diff-file-count", text: `${this.files.length ? 1 : 0}/${Math.max(1, this.files.length)} files` });
        button(left, "chevron-right", "Next File", () => this.navigateFile(1));
        separator(left);
        button(left, "collapse", "Collapse Unchanged Fragments", () => new Notice("Diff fragment collapsing is unavailable for this comparison."));
        button(right, "layout-sidebar-left", "Side by side", () => { this.mode = "split"; this.render(); }, this.mode === "split");
        button(right, "layout", "Unified", () => { this.mode = "unified"; this.render(); }, this.mode === "unified");
        button(right, "settings", "Diff Settings", () => new Notice("Diff settings are not available for this comparison."));
        const output = this.contentEl.createEl("pre", { cls: "pw-git-output", attr: { tabindex: "0" } });
        renderDiff(output, this.raw, this.files, this.mode, undefined, 3000, this.historical ? { historical: true, revision: this.revision } : undefined);
    }

    navigate(direction) {
        const hunks = [...this.contentEl.querySelectorAll(".pw-diff-hunk")];
        if (!hunks.length) return;
        this.index = this.index === undefined ? (direction > 0 ? 0 : hunks.length - 1) : (this.index + direction + hunks.length) % hunks.length;
        hunks[this.index].scrollIntoView({ block: "center" }); hunks[this.index].focus({ preventScroll: true });
    }

    navigateFile(step) {
        const files = [...this.contentEl.querySelectorAll(".pw-diff-file")];
        if (!files.length) return;
        const index = Math.max(0, Math.min(files.length - 1, (this.fileIndex ?? 0) + step));
        this.fileIndex = index; files[index].scrollIntoView({ block: "start" });
    }

    jumpToSource() {
        const line = this.contentEl.querySelector("[data-new-line][data-path]");
        if (!line) return;
        const content = this.controller.plugin ? this.controller.plugin : undefined;
        if (!content) return;
        new Notice("Open source from the Diff line context menu.");
    }

    onClose() { this.scope?.dispose(); this.contentEl.empty(); }
}
