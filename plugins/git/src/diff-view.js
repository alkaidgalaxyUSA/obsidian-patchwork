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
    getState() { return { title: this.title, text: this.comparison === "working" ? undefined : this.text, paths: this.paths, comparison: this.comparison, revision: this.revision, mode: this.mode, staged: this.staged, baseline: this.baseline, root: this.root }; }

    async onOpen() {
        this.scope = scopeModule(this.contentEl, "git", { surface: "diff" });
        this.contentEl.classList.add("pw-git-diff-view");
        this.stopHistory = this.controller.plugin.history.onChange(() => this.scheduleRefresh());
        this.registerInterval(this.contentEl.ownerDocument.defaultView.setInterval(() => {
            if (this.contentEl.isShown()) this.scheduleRefresh();
        }, 5000));
    }

    async setState(state, result) {
        this.title = state.title || "Git Diff";
        this.root = state.root || this.controller.repository.root;
        this.text = state.text || "No changes.";
        this.paths = Array.isArray(state.paths) ? state.paths : state.path ? [state.path] : [];
        this.comparison = state.comparison;
        this.revision = state.revision;
        this.mode = state.mode === "split" ? "split" : "unified";
        this.staged = !!state.staged;
        this.baseline = state.baseline === "index" || state.staged ? "index" : "head";
        this.renderedSignature = undefined;
        await this.refresh(this.comparison === "working");
        await super.setState(state, result);
    }

    async refresh(live = false) {
        const generation = ++this.generation;
        const root = this.controller.repository.root;
        try {
            if (live && this.root !== root) throw new Error("This diff belongs to another repository. Open it again from that repository.");
            let text = this.text;
            if (live && this.paths.length) {
                const entries = await this.controller.repository.status();
                const unborn = this.baseline === "head" && !this.staged && !await this.controller.repository.head();
                const paths = [...new Set([...this.paths, ...entries.filter(entry => entry.original && this.paths.includes(entry.path)).map(entry => entry.original)])];
                text = unborn ? "" : await this.controller.plugin.history.git.diff(paths, this.staged, !!this.fullContext, this.baseline);
                if (!this.staged) for (const entry of entries.filter(entry => (entry.untracked || unborn && !entry.code.includes("D")) && this.paths.some(path => path === "." || entry.path === path || entry.path.startsWith(path + "/")))) text += await this.controller.plugin.history.git.diffUntracked(entry.path, !!this.fullContext);
            }
            const signature = JSON.stringify([text, this.mode, this.staged, this.baseline, this.fullContext]);
            if (this.closed || generation !== this.generation || root !== this.controller.repository.root) return;
            if (signature === this.renderedSignature) return;
            const files = await this.controller.plugin.history.git.parseDiff(text);
            if (this.closed || generation !== this.generation || root !== this.controller.repository.root) return;
            this.text = text; this.files = files;
            this.renderedSignature = signature;
            this.render();
        } catch (error) {
            if (this.closed || generation !== this.generation) return;
            this.renderedSignature = undefined;
            this.contentEl.empty();
            this.contentEl.createDiv({ text: `Could not refresh diff: ${error.message}`, attr: { role: "status" } });
        }
    }

    scheduleRefresh() {
        if (this.closed || this.comparison !== "working" || this.controller.busy || !this.controller.ready) return;
        clearTimeout(this.refreshTimer);
        this.refreshTimer = setTimeout(() => { if (!this.closed && !this.controller.busy) void this.refresh(true); }, 150);
    }

    render() {
        const scrollTop = this.contentEl.scrollTop;
        const focusLabel = this.contentEl.contains(this.contentEl.ownerDocument.activeElement) ? this.contentEl.ownerDocument.activeElement.textContent : undefined;
        this.contentEl.empty();
        this.contentEl.classList.toggle("is-line-wrap", !!this.wrap);
        const toolbar = this.contentEl.createDiv({ cls: "pw-git-diff-actions" });
        const action = (label, callback, selected = false) => {
            const button = toolbar.createEl("button", { text: label, attr: { type: "button", "aria-pressed": String(selected) } });
            button.onclick = callback;
        };
        action("Unified", () => { this.mode = "unified"; this.render(); }, this.mode === "unified");
        action("Side by side", () => { this.mode = "split"; this.render(); }, this.mode === "split");
        if (this.comparison === "working") {
            const baseline = toolbar.createEl("select", { attr: { "aria-label": "Diff comparison" } });
            for (const [value, text] of [["head", "HEAD → Working tree"], ["index", "Index → Working tree"], ["staged", "HEAD → Index (staged)"]]) baseline.createEl("option", { value, text });
            baseline.value = this.staged ? "staged" : this.baseline;
            baseline.onchange = () => { this.staged = baseline.value === "staged"; this.baseline = baseline.value === "head" ? "head" : "index"; void this.refresh(true); };
            action("Full context", () => { this.fullContext = !this.fullContext; void this.refresh(true); }, !!this.fullContext);
            action("Refresh", () => void this.refresh(true));
        }
        action("Wrap lines", () => { this.wrap = !this.wrap; this.render(); }, !!this.wrap);
        for (const [label, step] of [["Previous hunk", -1], ["Next hunk", 1]]) action(label, () => {
            const hunks = [...this.contentEl.querySelectorAll(".pw-diff-hunk")];
            if (!hunks.length) return;
            this.hunkIndex = Math.max(0, Math.min(hunks.length - 1, (this.hunkIndex ?? -1) + step));
            hunks[this.hunkIndex].scrollIntoView({ block: "center" });
        });
        const navigation = toolbar.createEl("select", { attr: { "aria-label": "Navigate changed files" } });
        navigation.createEl("option", { text: "Changed files", value: "" });
        for (const [index, file] of (this.files || []).entries()) navigation.createEl("option", { text: file.path, value: String(index) });
        navigation.onchange = () => { if (navigation.value !== "") this.contentEl.querySelectorAll(".pw-diff-file")[Number(navigation.value)]?.scrollIntoView({ block: "center" }); };
        const output = this.contentEl.createEl("pre", { cls: "pw-git-output" });
        renderDiff(output, this.text, this.files, this.mode, (event, file, fileIndex, hunkIndex) => this.hunkMenu(event, file, fileIndex, hunkIndex));
        this.contentEl.scrollTop = scrollTop;
        if (focusLabel) [...toolbar.querySelectorAll("button")].find(button => button.textContent === focusLabel)?.focus({ preventScroll: true });
    }

    hunkMenu(event, file, fileIndex, hunkIndex) {
        if (this.comparison !== "working" || this.closed) return;
        event.preventDefault();
        const menu = scopeGitMenu(new Menu(), this.contentEl);
        this.menus.add(menu); menu.onHide(() => this.menus.delete(menu));
        if (this.fullContext) {
            menu.addItem(item => item.setTitle("Use compact context to stage or revert hunks").onClick(() => { this.fullContext = false; void this.refresh(true); }));
            menu.showAtMouseEvent(event); return;
        }
        const safe = file.change === "modified" && !file.oldPath && !file.binary;
        const action = (label, operation) => menu.addItem(item => item.setTitle(label).setDisabled(!safe || this.controller.busy).onClick(() => void this.changeHunk(operation, file, fileIndex, hunkIndex)));
        if (!this.staged && this.baseline === "head") {
            menu.addItem(item => item.setTitle("Switch to Unstaged to stage or revert hunks").onClick(() => { this.baseline = "index"; void this.refresh(true); }));
        }
        else if (this.staged) action("Unstage hunk", "unstage");
        else { action("Stage hunk", "stage"); action("Revert hunk…", "revert"); }
        menu.showAtMouseEvent(event);
    }

    async changeHunk(action, file, fileIndex, hunkIndex) {
        const generation = this.generation;
        try {
            if (this.root !== this.controller.repository.root) throw new Error("The repository changed. Reopen the diff.");
            const { patch, section } = hunkPatch(this.text, fileIndex, hunkIndex);
            if (action === "revert" && !await confirm(this.controller, "Revert Hunk", `Discard this hunk from ${file.path}?`, "Revert")) return;
            if (this.closed || generation !== this.generation) return;
            await this.controller.plugin.history.git.applyHunk(patch, action, file.path, section);
            if (!this.closed) await this.refresh(true);
        } catch (error) { if (!this.closed) new Notice(error.message); }
    }

    async onClose() {
        this.closed = true; ++this.generation;
        clearTimeout(this.refreshTimer); this.stopHistory?.();
        for (const menu of this.menus) menu.hide(); this.menus.clear();
        this.scope?.dispose();
    }
}
