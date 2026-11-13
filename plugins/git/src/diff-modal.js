import { Modal, Notice } from "obsidian";
import { setIcon } from "./utils/icons";
import { renderDiff } from "./history/utils/render-diff";
import { scopeModule } from "../../utils/module-scope";
import { enableModalDrag } from "./utils/modal-drag";
import { enableModalResize } from "./utils/modal-resize";
import { navigateDifference } from "./utils/diff-navigation";
import { diffSettings } from "./utils/diff-settings";
import { differenceCount } from "./utils/difference-count";

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
        this.align = options.align === true; this.sync = options.sync !== false; this.wrap = false; this.collapse = true; this.menus = new Set();
        this.historical = options.historical === true;
        this.revision = options.revision;
        this.baseRevisions = options.baseRevisions;
        this.setTitle(title);
        this.modalEl.classList.add("pw-git-diff-modal");
    }

    onOpen() {
        if (this.modalEl.ownerDocument !== this.document) { this.close(); return; }
        this.scope = scopeModule(this.modalEl, "git", { surface: "diff" });
        this.footer = this.modalEl.createDiv({ cls: "pw-diff-footer", attr: { "aria-hidden": "true" } });
        this.contentEl.classList.add("pw-git-diff-view");
        this.stopDrag = enableModalDrag(this.modalEl, this.titleEl);
        this.stopResize = enableModalResize(this.modalEl);
        this.onKey = event => { if (event.key === "F7") { event.preventDefault(); this.navigate(event.shiftKey ? -1 : 1); } };
        this.contentEl.addEventListener("keydown", this.onKey);
        this.render();
    }

    render() {
        const positions = [...this.contentEl.querySelectorAll(".pw-diff-documents")].map(el => [...el.querySelectorAll(".pw-diff-document")].map(side => [side.scrollTop, side.scrollLeft]));
        this.clearDocumentListeners();
        this.contentEl.empty();
        const toolbar = this.contentEl.createDiv({ cls: "pw-git-diff-actions" });
        const left = toolbar.createDiv({ cls: "pw-git-diff-actions-left" });
        const right = toolbar.createDiv({ cls: "pw-git-diff-actions-right" });
        const button = (host, icon, label, action, selected = false) => {
            const el = host.createEl("button", { attr: { type: "button", "aria-label": label, "aria-pressed": String(selected) } });
            if (icon) setIcon(el, icon);
            el.title = label; el.onclick = action; return el;
        };
        const separator = host => host.createSpan({ cls: "pw-git-diff-separator", text: "|", attr: { "aria-hidden": "true" } });
        button(left, "idea/expui/general/up_dark.svg", "Previous Difference", () => this.navigate(-1));
        button(left, "idea/expui/general/down_dark.svg", "Next Difference", () => this.navigate(1));
        separator(left);
        button(left, "idea/expui/general/edit_dark.svg", "Jump to Source", () => this.jumpToSource());
        separator(left);
        button(left, "idea/expui/general/left_dark.svg", "Previous File", () => this.navigateFile(-1));
        this.fileCountLabel = left.createSpan({ cls: "pw-git-diff-file-count" });
        this.updateFileCount();
        button(left, "idea/expui/general/right_dark.svg", "Next File", () => this.navigateFile(1));
        separator(left);
        button(left, "git-collapse-all", "Collapse Unchanged Fragments", () => { this.collapse = !this.collapse; this.render(); }, this.collapse);
        this.differenceLabel = right.createSpan({ cls: "pw-git-diff-difference-count", attr: { "aria-live": "polite" } });
        this.updateDifferenceCount();
        const viewers = right.createDiv({ cls: "pw-diff-viewer-toggles" });
        button(viewers, null, "Side by side", () => { this.mode = "split"; this.render(); }, this.mode === "split").classList.add("pw-diff-viewer-toggle");
        button(viewers, null, "Unified", () => { this.mode = "unified"; this.render(); }, this.mode === "unified").classList.add("pw-diff-viewer-toggle");
        button(right, "settings", "Diff Settings", event => diffSettings(this, event));
        const output = this.contentEl.createEl("pre", { cls: "pw-git-output", attr: { tabindex: "0" } });
        renderDiff(output, this.raw, this.files, this.mode, undefined, 3000, {
            positions, onExpandContext: () => { this.collapse = false; this.render(); },
            align: this.align, sync: this.sync, wrap: this.wrap, collapse: this.collapse,
            historical: this.historical, revision: this.revision, baseRevisions: this.baseRevisions,
            registerCleanup: cleanup => this.documentListeners.push(cleanup),
        });
    }

    navigate(direction) {
        const selected = navigateDifference(this.contentEl, this.index, direction);
        if (!selected) return;
        this.index = selected.index; this.fileIndex = selected.fileIndex;
        this.updateFileCount(); this.updateDifferenceCount();
    }

    navigateFile(step) {
        const files = [...this.contentEl.querySelectorAll(".pw-diff-file")];
        if (!files.length) return;
        const index = Math.max(0, Math.min(files.length - 1, (this.fileIndex ?? 0) + step));
        this.fileIndex = index; files[index].scrollIntoView({ block: "start" });
        this.updateDifferenceCount();
        this.updateFileCount();
    }

    updateFileCount() {
        this.fileCountLabel.setText(`${this.files.length ? (this.fileIndex ?? 0) + 1 : 0}/${this.files.length} files`);
    }

    updateDifferenceCount() {
        const count = differenceCount(this.files[this.fileIndex ?? 0]);
        this.differenceLabel.setText(`${count} difference${count === 1 ? "" : "s"}`);
    }

    jumpToSource() {
        const line = this.contentEl.querySelector("[data-new-line][data-path]");
        if (!line) return;
        const content = this.controller.plugin ? this.controller.plugin : undefined;
        if (!content) return;
        new Notice("Open source from the Diff line context menu.");
    }

    clearDocumentListeners() {
        for (const cleanup of this.documentListeners ?? []) cleanup();
        this.documentListeners = [];
    }

    onClose() { this.contentEl.removeEventListener("keydown", this.onKey); for (const menu of this.menus) menu.hide(); this.menus.clear(); this.clearDocumentListeners(); this.stopDrag?.(); this.stopResize?.(); this.footer?.remove(); this.scope?.dispose(); this.contentEl.empty(); }
}
