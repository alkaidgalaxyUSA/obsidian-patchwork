import { ItemView, Menu, Notice, setIcon } from "obsidian";
import { iconName } from "./utils/icons";
import { scopeModule } from "../../utils/module-scope";
import { scopeGitMenu } from "./utils/portals";
import { confirm } from "./dialogs";
import { hunkPatch } from "./history/utils/diff-patch";
import { renderDiff } from "./history/utils/render-diff";
import { withWorktreeIndex } from "./utils/worktree-renames";
import { getServiceRegistry } from "../../utils/service-registry";
import { getWindowContext } from "../../utils/windows";

export const DIFF_VIEW = "patchwork-git-diff";

/** Patchwork's diff tab uses History capabilities without its view layer. */
export class DiffView extends ItemView {
    constructor(leaf, controller) { super(leaf); this.controller = controller; this.generation = 0; this.menus = new Set(); }
    getViewType() { return DIFF_VIEW; }
    getDisplayText() { return this.title || "Git Diff"; }
    getIcon() { return iconName("git-show-diff"); }
    getState() { return { title: this.title, text: this.comparison === "working" ? undefined : this.text, paths: this.paths, comparison: this.comparison, revision: this.revision, historical: this.historical, mode: this.mode, wrap: this.wrap, fullContext: this.fullContext, staged: this.staged, baseline: this.baseline, root: this.root }; }

    async onOpen() {
        this.moduleScope = scopeModule(this.contentEl, "git", { surface: "diff" });
        this.contentEl.classList.add("pw-git-diff-view");
        this.registerDomEvent(this.contentEl, "keydown", event => {
            if (event.key !== "F7") return;
            event.preventDefault(); this.navigateHunk(event.shiftKey ? -1 : 1);
        });
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
        this.historical = state.historical === true;
        const preferences = this.controller.plugin.settingsStore.preferences;
        this.mode = (state.mode ?? preferences.diffMode) === "split" ? "split" : "unified";
        this.wrap = state.wrap ?? preferences.diffWrap ?? false;
        this.fullContext = state.fullContext ?? preferences.diffFullContext ?? false;
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
                const selected = entries.filter(entry => this.paths.some(path => path === "." || entry.path === path || entry.path.startsWith(path + "/") || entry.original === path));
                const paths = [...new Set([...this.paths, ...selected.flatMap(entry => [entry.path, entry.original].filter(Boolean))])];
                const moved = !this.staged && selected.some(entry => entry.worktreeRename);
                if (moved) text = await withWorktreeIndex(this.controller.repository, paths, (env, baseline) => this.controller.repository.run([
                    "diff", "--cached", "--no-ext-diff", "--no-textconv", "--no-color", "-M", ...(this.fullContext ? ["-U99999"] : []), this.baseline === "head" ? "HEAD" : baseline, "--", ...paths,
                ], { env }));
                else text = unborn ? "" : await this.controller.plugin.history.git.diff(paths, this.staged, !!this.fullContext, this.baseline);
                if (!this.staged && !moved) for (const entry of selected.filter(entry => entry.untracked || unborn && !entry.code.includes("D"))) text += await this.controller.plugin.history.git.diffUntracked(entry.path, !!this.fullContext);
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
        const left = toolbar.createDiv({ cls: "pw-git-diff-actions-left" });
        const center = toolbar.createDiv({ cls: "pw-git-diff-actions-center" });
        const right = toolbar.createDiv({ cls: "pw-git-diff-actions-right" });
        const iconAction = (host, icon, label, callback, selected = false) => {
            const button = host.createEl("button", { attr: { type: "button", "aria-label": label, "aria-pressed": String(selected) } });
            setIcon(button, icon);
            button.title = label;
            button.onclick = callback;
            return button;
        };
        const separator = host => host.createSpan({ cls: "pw-git-diff-separator", text: "|", attr: { "aria-hidden": "true" } });
        const selectedPath = this.paths?.[0];
        const fileIndex = Math.max(0, (this.files || []).findIndex(file => file.path === selectedPath || file.oldPath === selectedPath));
        iconAction(left, "arrow-up", "Previous Difference", () => this.navigateHunk(-1));
        iconAction(left, "arrow-down", "Next Difference", () => this.navigateHunk(1));
        iconAction(left, "edit", "Jump to Source", () => this.jumpToSource());
        separator(left);
        iconAction(left, "chevron-left", "Previous File", () => this.navigateFile(-1));
        center.createSpan({ cls: "pw-git-diff-file-count", text: `${fileIndex + 1}/${Math.max(1, (this.files || []).length)} files` });
        iconAction(left, "chevron-right", "Next File", () => this.navigateFile(1));
        separator(left);
        iconAction(left, "collapse", "Collapse Unchanged Fragments", () => { this.fullContext = !this.fullContext; this.savePreferences(); void this.refresh(this.comparison === "working"); }, !this.fullContext);
        if ((this.files || []).length && (this.files || []).some(file => file.hunks?.length)) center.createSpan({ cls: "pw-git-diff-difference-count", text: `${(this.files || []).reduce((count, file) => count + (file.hunks?.length || 0), 0)} difference${(this.files || []).reduce((count, file) => count + (file.hunks?.length || 0), 0) === 1 ? "" : "s"}` });
        iconAction(right, "layout-sidebar-left", "Side by side", () => { this.mode = "split"; this.savePreferences(); this.render(); }, this.mode === "split");
        iconAction(right, "layout", "Unified", () => { this.mode = "unified"; this.savePreferences(); this.render(); }, this.mode === "unified");
        iconAction(right, "settings", "Diff Settings", () => { this.wrap = !this.wrap; this.savePreferences(); this.render(); }, !!this.wrap);
        if (this.comparison === "working") {
            const baseline = center.createEl("select", { attr: { "aria-label": "Diff comparison" } });
            for (const [value, text] of [["head", "HEAD → Working tree"], ["index", "Index → Working tree"], ["staged", "HEAD → Index (staged)"]]) baseline.createEl("option", { value, text });
            baseline.value = this.staged ? "staged" : this.baseline;
            baseline.onchange = () => { this.staged = baseline.value === "staged"; this.baseline = baseline.value === "head" ? "head" : "index"; void this.refresh(true); };
            iconAction(right, "refresh-cw", "Refresh", () => void this.refresh(true));
        }
        const output = this.contentEl.createEl("pre", { cls: "pw-git-output" });
        renderDiff(output, this.text, this.files, this.mode,
            this.historical ? undefined : (event, file, fileIndex, hunkIndex) => this.hunkMenu(event, file, fileIndex, hunkIndex),
            3000, this.historical ? { historical: true, revision: this.revision } : undefined);
        output.ondblclick = event => {
            const line = event.target.closest("[data-new-line][data-path]");
            if (line) void this.openWorkingLine(line.dataset.path, Number(line.dataset.newLine));
        };
        output.onkeydown = event => {
            if (event.key !== "Enter") return;
            const line = event.target.querySelector?.("[data-new-line][data-path]");
            if (line) { event.preventDefault(); void this.openWorkingLine(line.dataset.path, Number(line.dataset.newLine)); }
        };
        this.contentEl.scrollTop = scrollTop;
        if (focusLabel) [...toolbar.querySelectorAll("button")].find(button => button.textContent === focusLabel)?.focus({ preventScroll: true });
    }

    navigateFile(step) {
        const files = [...this.contentEl.querySelectorAll(".pw-diff-file")];
        if (!files.length) return;
        const current = files.findIndex(file => file.getBoundingClientRect().top >= this.contentEl.getBoundingClientRect().top - 4);
        const index = Math.max(0, Math.min(files.length - 1, (current < 0 ? 0 : current) + step));
        files[index]?.scrollIntoView({ block: "start" });
    }

    jumpToSource() {
        const line = this.contentEl.querySelector("[data-new-line][data-path]");
        if (line) void this.openWorkingLine(line.dataset.path, Number(line.dataset.newLine));
    }

    savePreferences() {
        void this.controller.plugin.settingsStore.savePreferences({ diffMode: this.mode, diffWrap: this.wrap, diffFullContext: this.fullContext }).catch(error => new Notice(error.message));
        this.app.workspace.requestSaveLayout();
    }

    navigateHunk(step) {
        const hunks = [...this.contentEl.querySelectorAll(".pw-diff-hunk")];
        if (!hunks.length) return;
        this.hunkIndex = Math.max(0, Math.min(hunks.length - 1, (this.hunkIndex ?? -1) + step));
        hunks[this.hunkIndex].focus({ preventScroll: true });
        hunks[this.hunkIndex].scrollIntoView({ block: "center" });
    }

    async openWorkingLine(path, line) {
        try {
            if (this.root !== this.controller.repository.root) throw new Error("The repository changed. Reopen the diff.");
            const vaultPath = this.controller.snapshots.vaultPath(path);
            const content = getServiceRegistry(this.app).get("content");
            if (!vaultPath || !content) throw new Error("The working file or editor service is unavailable.");
            const context = getWindowContext(this.contentEl.ownerDocument);
            const location = await content.openDocument({ ...context, path: vaultPath, target: "new-tab", groupLeafId: this.leaf.id, focus: true });
            if (this.closed || this.root !== this.controller.repository.root) return;
            await content.navigate({ ...location, line: Math.max(0, line - 1), column: 0 }, context);
        } catch (error) { if (!this.closed) new Notice(error.message); }
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
        this.moduleScope?.dispose();
    }
}
