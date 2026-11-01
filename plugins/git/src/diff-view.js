import { ItemView, Menu, Notice } from "obsidian";
import { iconName } from "./utils/icons";
import { scopeModule } from "../../utils/module-scope";
import { scopeGitMenu } from "./utils/portals";
import { confirm } from "./dialogs";
import { hunkPatch } from "./history/utils/diff-patch";
import { renderDiff } from "./history/utils/render-diff";

export const DIFF_VIEW = "patchwork-git-diff";

/** Patchwork's diff tab uses History capabilities without its view layer. */
export class DiffView extends ItemView {
    constructor(leaf, controller) { super(leaf); this.controller = controller; this.generation = 0; this.menus = new Set(); }
    getViewType() { return DIFF_VIEW; }
    getDisplayText() { return this.title || "Git Diff"; }
    getIcon() { return iconName("git-show-diff"); }
    getState() { return { title: this.title, text: this.text, paths: this.paths, comparison: this.comparison, revision: this.revision, mode: this.mode, staged: this.staged }; }

    async onOpen() {
        this.scope = scopeModule(this.contentEl, "git", { surface: "diff" });
        this.contentEl.classList.add("pw-git-diff-view");
    }

    async setState(state, result) {
        this.title = state.title || "Git Diff";
        this.text = state.text || "No changes.";
        this.paths = Array.isArray(state.paths) ? state.paths : state.path ? [state.path] : [];
        this.comparison = state.comparison;
        this.revision = state.revision;
        this.mode = state.mode === "split" ? "split" : "unified";
        this.staged = !!state.staged;
        await this.refresh(this.comparison === "working");
        await super.setState(state, result);
    }

    async refresh(live = false) {
        const generation = ++this.generation;
        try {
            let text = this.text;
            if (live && this.paths.length) {
                text = await this.controller.plugin.history.git.diff(this.paths, this.staged);
                if (!this.staged) for (const entry of this.controller.entries.filter(entry => entry.untracked && this.paths.some(path => path === "." || entry.path === path || entry.path.startsWith(path + "/")))) text += await this.controller.plugin.history.git.diffUntracked(entry.path);
            }
            const files = await this.controller.plugin.history.git.parseDiff(text);
            if (this.closed || generation !== this.generation) return;
            this.text = text; this.files = files;
            this.render();
        } catch (error) { if (!this.closed && generation === this.generation) new Notice(error.message); }
    }

    render() {
        this.contentEl.empty();
        const toolbar = this.contentEl.createDiv({ cls: "pw-git-diff-actions" });
        const action = (label, callback, selected = false) => {
            const button = toolbar.createEl("button", { text: label, attr: { type: "button", "aria-pressed": String(selected) } });
            button.onclick = callback;
        };
        action("Unified", () => { this.mode = "unified"; this.render(); }, this.mode === "unified");
        action("Side by side", () => { this.mode = "split"; this.render(); }, this.mode === "split");
        if (this.comparison === "working") {
            action("Working tree", () => { this.staged = false; void this.refresh(true); }, !this.staged);
            action("Staged", () => { this.staged = true; void this.refresh(true); }, this.staged);
            action("Refresh", () => void this.refresh(true));
        }
        const output = this.contentEl.createEl("pre", { cls: "pw-git-output" });
        renderDiff(output, this.text, this.files, this.mode, (event, file, fileIndex, hunkIndex) => this.hunkMenu(event, file, fileIndex, hunkIndex));
    }

    hunkMenu(event, file, fileIndex, hunkIndex) {
        if (this.comparison !== "working" || this.closed) return;
        event.preventDefault();
        const menu = scopeGitMenu(new Menu(), this.contentEl);
        this.menus.add(menu); menu.onHide(() => this.menus.delete(menu));
        const safe = file.change === "modified" && !file.oldPath && !file.binary;
        const action = (label, operation) => menu.addItem(item => item.setTitle(label).setDisabled(!safe || this.controller.busy).onClick(() => void this.changeHunk(operation, file, fileIndex, hunkIndex)));
        if (this.staged) action("Unstage hunk", "unstage");
        else { action("Stage hunk", "stage"); action("Revert hunk…", "revert"); }
        menu.showAtMouseEvent(event);
    }

    async changeHunk(action, file, fileIndex, hunkIndex) {
        const generation = this.generation;
        try {
            const { patch, section } = hunkPatch(this.text, fileIndex, hunkIndex);
            if (action === "revert" && !await confirm(this.controller, "Revert Hunk", `Discard this hunk from ${file.path}?`, "Revert")) return;
            if (this.closed || generation !== this.generation) return;
            await this.controller.plugin.history.git.applyHunk(patch, action, file.path, section);
            if (!this.closed) await this.refresh(true);
        } catch (error) { if (!this.closed) new Notice(error.message); }
    }

    async onClose() {
        this.closed = true; ++this.generation;
        for (const menu of this.menus) menu.hide(); this.menus.clear();
        this.scope?.dispose();
    }
}
