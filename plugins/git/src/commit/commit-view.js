import { ItemView, Menu, Modal, Notice } from "obsidian";
import { iconName, setIcon } from "../utils/icons";
import { addCommitMenu } from "./commit-context-menu";
import { CommitSplitter } from "./commit-splitter";
import { OperationPanel } from "./operation-panel";
import { fileIcon } from "../utils/file-icons";
import { fileStatus } from "../utils/file-status.js";
import { scopeModule } from "../../../utils/module-scope";
import { openGitDialog, scopeGitMenu } from "../utils/portals";
import { getServiceRegistry } from "../../../utils/service-registry";
import { getWindowContext } from "../../../utils/windows";
import { CommitFileActions } from "./file-actions";

export const COMMIT_VIEW = "patchwork-git-commit";

export class CommitView extends ItemView {
    constructor(leaf, controller) {
        super(leaf); this.controller = controller;
        const preferences = controller.plugin.settingsStore.preferences;
        this.showPaths = preferences.commitShowPaths !== false;
        this.sortByPath = preferences.commitSortByPath === true;
        this.groupDirectories = preferences.commitGroupDirectories === true;
        this.actionSelection = new Set();
    }
    getViewType() { return COMMIT_VIEW; }
    getDisplayText() { return "Commit"; }
    getIcon() { return iconName("idea/expui/toolwindows/commit_dark.svg"); }

    async onOpen() {
        this.contentEl.empty();
        this.contentEl.classList.add("pw-git-commit-panel");
        this.moduleScope = scopeModule(this.contentEl, "git", { surface: "commit" });
        this.previousFocused = this.contentEl.getAttribute("data-pw-panel-focused");
        const registry = getServiceRegistry(this.app);
        const focused = value => this.contentEl.setAttribute("data-pw-panel-focused", String(value));
        this.stopBorders = registry.watch("git", "borders", borders => {
            this.stopPanelState?.();
            focused(borders?.getPanelState("git:commit", getWindowContext(this.contentEl.ownerDocument))?.focused ?? false);
            this.stopPanelState = borders?.onPanelState(state => {
                if (state.id === "git:commit" && state.windowId === getWindowContext(this.contentEl.ownerDocument).windowId) focused(state.focused);
            });
        });
        this.registerDomEvent(this.contentEl, "focusin", () => { if (!registry.get("borders")) focused(true); });
        this.registerDomEvent(this.contentEl, "focusout", event => {
            if (!registry.get("borders") && !this.contentEl.contains(event.relatedTarget)) focused(false);
        });
        const header = this.contentEl.createDiv({ cls: "pw-git-commit-header" });
        header.createSpan({ text: "Commit" });
        const headerActions = header.createDiv({ cls: "pw-git-commit-header-actions" });
        const more = headerActions.createEl("button", { cls: "clickable-icon", attr: { type: "button", "aria-label": "More Commit Actions", "aria-haspopup": "menu" } });
        setIcon(more, "git-header-more");
        this.registerDomEvent(more, "click", () => this.viewOptions(more));
        const hide = headerActions.createEl("button", { cls: "clickable-icon", attr: { type: "button", "aria-label": "Hide Commit" } });
        setIcon(hide, "git-header-hide");
        this.registerDomEvent(hide, "click", () => {
            const borders = registry.get("borders");
            if (!borders) { new Notice("Commit panel hiding is unavailable while Patchwork Borders is disabled."); return; }
            borders.hidePanel("git:commit", getWindowContext(this.contentEl.ownerDocument));
        });
        const toolbar = this.contentEl.createDiv({ cls: "pw-git-commit-toolbar", attr: { role: "toolbar", "aria-label": "Changes actions" } });
        this.tools = new Map();
        this.tool(toolbar, "Refresh Changes", "git-log-refresh", () => this.controller.refresh());
        this.tool(toolbar, "Rollback", "git-rollback", () => this.controller.rollback(this.selectedPaths()));
        this.tool(toolbar, "Show Diff", "git-show-diff", () => this.controller.showDiff(this.selectedPaths(), false, this.selectedStage));
        const listsButton = this.tool(toolbar, "Changelists", "idea-expui-vcs-changelist_dark.svg", () => this.changelistMenu(listsButton));
        listsButton.setAttribute("aria-haspopup", "menu");
        this.tool(toolbar, "Stage Selected", "plus", () => this.controller.stageSelection(this.selectedPaths()));
        this.tool(toolbar, "Unstage Selected", "idea/expui/general/remove_dark.svg", () => this.controller.stageSelection(this.selectedPaths(), true));
        this.tool(toolbar, "Shelve Silently", "git-shelve", () => this.controller.shelve(this.selectedPaths()));
        const optionsButton = this.tool(toolbar, "View Options", "git-log-view", () => this.viewOptions(optionsButton));
        optionsButton.setAttribute("aria-haspopup", "menu");
        toolbar.createSpan({ cls: "pw-git-toolbar-separator", attr: { "aria-hidden": "true" } });
        this.tool(toolbar, "Select Opened File in Change View", "select-opened-file", () => this.selectOpenedFile());
        this.tool(toolbar, "Expand All", "git-expand-all", () => { this.controller.collapsed.clear(); this.saveCollapsed(); this.controller.render(); });
        this.tool(toolbar, "Collapse All", "git-collapse-all", () => { this.controller.collapsed = new Set([...this.controller.changelists.lists.map(list => list.id), "Unversioned Files", "Staged", "Unstaged", "Conflicts"]); this.saveCollapsed(); this.controller.render(); });
        this.status = this.contentEl.createDiv({ cls: "pw-git-panel-status", attr: { role: "status", "aria-live": "polite" } });
        this.operationPanel = new OperationPanel(this.controller, this.contentEl);
        const body = this.contentEl.createDiv({ cls: "pw-git-commit-body" });
        this.files = body.createDiv({ cls: "pw-git-change-list", attr: { role: "tree", "aria-label": "Changes", "aria-multiselectable": "true" } });
        this.files.oncontextmenu = event => this.openContextMenu(event, this.selectedPaths());
        const separator = body.createDiv({ cls: "pw-git-commit-splitter" });
        this.splitter = new CommitSplitter(body, separator, this.controller.plugin.settingsStore.preferences.commitSplitRatio,
            ratio => { void this.controller.plugin.settingsStore.savePreferences({ commitSplitRatio: ratio }).catch(error => new Notice(error.message)); });
        const footer = body.createDiv({ cls: "pw-git-commit-footer" });
        const mode = footer.createEl("label", { cls: "pw-git-commit-mode", text: "Commit source" });
        this.commitMode = mode.createEl("select");
        this.commitMode.createEl("option", { value: "staged", text: "All staged changes" });
        this.commitMode.createEl("option", { value: "working", text: "Checked files: all changes" });
        this.commitMode.value = this.controller.commitMode;
        this.commitMode.onchange = () => {
            this.controller.commitMode = this.commitMode.value;
            this.selectedStage = undefined;
            this.controller.validationRequested = false;
            this.controller.saveDraft(); this.controller.render();
        };
        this.commitHint = footer.createDiv({ cls: "pw-git-commit-hint" });
        const options = footer.createDiv({ cls: "pw-git-commit-options" });
        this.commitAllLabel = options.createEl("label", { cls: "pw-git-amend" });
        this.commitAll = this.commitAllLabel.createEl("input", { type: "checkbox" });
        this.commitAllLabel.createSpan({ text: "Commit all tracked changes" });
        this.commitAll.checked = this.controller.plugin.settingsStore.preferences.commitAllTracked === true;
        this.commitAll.onchange = () => {
            void this.controller.plugin.settingsStore.savePreferences({ commitAllTracked: this.commitAll.checked }).catch(error => new Notice(error.message));
            this.controller.render();
        };
        const amend = options.createEl("label", { cls: "pw-git-amend" });
        this.amend = amend.createEl("input", { type: "checkbox" });
        amend.createSpan({ text: "Amend" });
        this.amend.checked = this.controller.draft.amend;
        this.amend.onchange = async () => {
            this.controller.draft.amend = this.amend.checked;
            if (this.amend.checked && !this.message.value.trim()) {
                await this.controller.act(async () => {
                    const message = await this.controller.repository.run(["log", "-1", "--format=%B"]);
                    if (!this.controller.draft.amend || this.message.value.trim()) return;
                    this.controller.draft.message = message.trimEnd();
                    this.message.value = this.controller.draft.message;
                });
            }
            this.controller.saveDraft(); this.updateButtons();
        };
        this.lastCommit = options.createEl("button", { cls: "pw-git-last-commit", attr: { type: "button", "aria-haspopup": "menu", "aria-label": "Amend target", "aria-expanded": "false" } });
        this.lastCommit.createSpan({ text: "last commit" });
        setIcon(this.lastCommit.createSpan(), "chevron-down");
        this.lastCommit.onclick = () => {
            const menu = scopeGitMenu(new Menu(), this.contentEl);
            menu.dom.classList.add("pw-git-amend-target-menu");
            menu.addItem(item => { item.setTitle("last commit").setChecked(true); item.dom.classList.add("is-selected"); });
            this.showMenu(menu, this.lastCommit);
        };
        this.historyButton = options.createEl("button", { cls: "clickable-icon pw-git-message-history", attr: { type: "button", "aria-label": "Commit message history", "aria-haspopup": "menu", "aria-expanded": "false" } });
        setIcon(this.historyButton, "history");
        this.historyButton.onclick = () => void this.showMessageHistory();
        this.selectionSummary = options.createDiv({ cls: "pw-git-selection-summary", attr: { "aria-live": "polite" } });
        this.message = footer.createEl("textarea", { cls: "pw-git-commit-message", attr: {
            placeholder: "Commit message", "aria-label": "Commit message", spellcheck: "true",
        } });
        this.message.value = this.controller.draft.message;
        this.message.oninput = () => {
            this.controller.draft.message = this.message.value;
            this.controller.saveDraft(); this.updateButtons();
        };
        this.message.onkeydown = event => {
            if (event.key !== "Enter" || !(event.ctrlKey || event.metaKey)) return;
            event.preventDefault();
            if (!this.commitButton.disabled) void this.controller.commit(event.shiftKey);
        };
        this.validation = footer.createDiv({ cls: "pw-git-commit-error", attr: { role: "alert" } });
        const actions = footer.createDiv({ cls: "pw-git-commit-actions" });
        this.commitButton = actions.createEl("button", { text: "Commit", cls: "pw-git-commit-button" });
        this.pushButton = actions.createEl("button", { text: "Commit and Push..." });
        this.commitOptionsButton = actions.createEl("button", { cls: "clickable-icon pw-git-commit-settings", attr: {
            type: "button", "aria-label": "Show Commit Options", "aria-haspopup": "dialog", "aria-expanded": "false",
        } });
        setIcon(this.commitOptionsButton, "settings");
        this.commitOptionsButton.onclick = () => this.showCommitOptions();
        this.commitButton.onclick = () => void this.controller.commit(false);
        this.pushButton.onclick = () => void this.controller.commit(true);
        this.controller.views.add(this);
        this.render();
        void this.controller.refresh();
    }

    render() {
        if (!this.files) return;
        this.status.textContent = this.controller.error || (this.controller.busy ? "Git operation in progress…" : "");
        this.operationPanel.render();
        if (this.selectionRoot !== this.controller.repository.root) { this.actionSelection.clear(); this.selectionAnchor = undefined; this.selectionRoot = this.controller.repository.root; }
        const focused = this.files.contains(this.files.ownerDocument.activeElement) ? this.files.ownerDocument.activeElement.closest("[data-path]") : undefined;
        const focusedPath = focused?.dataset.path, focusedStage = focused?.dataset.stage;
        this.actionSelection = new Set([...this.actionSelection].filter(path => this.controller.entries.some(entry => entry.path === path)));
        this.files.empty();
        const entries = [...this.controller.entries].sort((a, b) => {
            const key = entry => this.sortByPath ? entry.path : entry.path.split("/").pop();
            return key(a).localeCompare(key(b)) || a.path.localeCompare(b.path);
        });
        if (this.controller.commitMode === "staged") {
            this.group("Staged", entries.filter(entry => entry.staged && !entry.conflict), true, undefined, "staged");
            this.group("Unstaged", entries.filter(entry => !entry.conflict && !entry.untracked && entry.code[1] !== " "), true, undefined, "unstaged");
            const conflicts = entries.filter(entry => entry.conflict);
            if (conflicts.length) this.group("Conflicts", conflicts, true);
        } else for (const list of this.controller.changelists.lists) {
            this.group(list.name, entries.filter(entry => !entry.untracked && this.controller.changelists.forPath(entry.path) === list.id), true, list.id);
        }
        const unversioned = entries.filter(entry => entry.untracked);
        if (unversioned.length) this.group("Unversioned Files", unversioned, false, undefined, this.controller.commitMode === "staged" ? "unstaged" : undefined);
        if (!entries.length && !this.controller.error) this.files.createDiv({ cls: "pw-git-panel-empty", text: this.controller.ready ? "No changes" : "Loading repository…" });
        this.updateActionSelection();
        if (focusedPath) [...this.files.querySelectorAll(".pw-git-change-file")].find(row => row.dataset.path === focusedPath && row.dataset.stage === focusedStage)?.focus({ preventScroll: true });
    }

    group(name, entries, bold, changelistId, stage) {
        const groupId = changelistId ?? name;
        const section = this.files.createDiv({ cls: "pw-git-change-group", attr: { role: "group", "aria-label": name } });
        const header = section.createDiv({ cls: "pw-git-change-heading", attr: { role: "treeitem", "aria-level": "1", "aria-expanded": String(!this.controller.collapsed.has(groupId)) } });
        header.dataset.groupId = groupId;
        header.tabIndex = -1;
        header.onclick = event => {
            if (event.target.closest("button, input")) return;
            this.selectedStage = stage; this.actionSelection = new Set(entries.map(entry => entry.path)); this.updateActionSelection();
            header.focus({ preventScroll: true });
        };
        header.ondblclick = event => {
            if (event.target.closest("button, input")) return;
            event.preventDefault();
            this.toggleGroup(groupId);
        };
        header.oncontextmenu = event => { this.selectedStage = stage; this.openContextMenu(event, entries.map(entry => entry.path), changelistId); };
        const toggle = header.createEl("button", { cls: "clickable-icon", attr: { "aria-label": name, "aria-expanded": String(!this.controller.collapsed.has(groupId)) } });
        const content = header.createDiv({ cls: "pw-git-change-content" });
        const checkbox = content.createEl("input", { type: "checkbox", attr: { "aria-label": `Select ${name}` } });
        content.createEl(bold ? "strong" : "span", { text: name });
        content.createSpan({ cls: "pw-git-file-count", text: `${entries.length} ${entries.length === 1 ? "file" : "files"}` });
        const chosen = entries.filter(entry => this.controller.selected.has(entry.path)).length;
        checkbox.checked = !!entries.length && chosen === entries.length;
        checkbox.indeterminate = chosen > 0 && chosen < entries.length;
        checkbox.disabled = this.controller.busy || !entries.length;
        checkbox.hidden = this.controller.commitMode === "staged";
        checkbox.onchange = () => {
            for (const entry of entries) {
                if (checkbox.checked) this.controller.selected.add(entry.path);
                else this.controller.selected.delete(entry.path);
            }
            this.controller.render();
        };
        const collapsed = this.controller.collapsed.has(groupId);
        setIcon(toggle, collapsed ? "chevron-right" : "chevron-down");
        toggle.onclick = event => {
            event.stopPropagation();
            this.toggleGroup(groupId);
        };
        if (collapsed) return;
        if (stage) {
            const action = header.createEl("button", { cls: "clickable-icon", attr: { type: "button", "aria-label": stage === "staged" ? `Unstage ${name}` : `Stage ${name}` } });
            setIcon(action, stage === "staged" ? "idea/expui/general/remove_dark.svg" : "plus");
            action.disabled = this.controller.busy || !this.controller.ready || !!this.controller.error || !entries.length;
            action.onclick = () => void this.controller.stageSelection(entries.map(entry => entry.path), stage === "staged");
        }
        const folders = new Map();
        for (const entry of entries) {
            const directory = this.groupDirectories ? entry.path.split("/").slice(0, -1).join("/") : "";
            if (!directory) { this.file(section, entry, stage); continue; }
            if (!folders.has(directory)) {
                const directoryId = `${groupId}:${directory}`;
                const details = section.createEl("details", { cls: "pw-git-change-directory" }); details.open = !this.controller.collapsed.has(directoryId);
                details.createEl("summary", { text: directory });
                details.ontoggle = () => {
                    if (!details.isConnected || this.controller.collapsed.has(directoryId) === !details.open) return;
                    if (details.open) this.controller.collapsed.delete(directoryId); else this.controller.collapsed.add(directoryId);
                    this.saveCollapsed();
                };
                folders.set(directory, details);
            }
            this.file(folders.get(directory), entry, stage);
        }
    }

    toggleGroup(groupId) {
        if (this.controller.collapsed.has(groupId)) this.controller.collapsed.delete(groupId);
        else this.controller.collapsed.add(groupId);
        this.saveCollapsed();
        this.render();
        [...this.files.querySelectorAll(".pw-git-change-heading")]
            .find(header => header.dataset.groupId === groupId)?.focus({ preventScroll: true });
    }

    file(section, entry, stage) {
        const row = section.createDiv({ cls: "pw-git-change-file", attr: { role: "treeitem", "aria-level": "2" } });
        row.dataset.path = entry.path;
        row.dataset.stage = stage || "working";
        row.tabIndex = 0;
        row.classList.add(`is-${fileStatus(stage && !entry.untracked ? { ...entry, code: stage === "staged" ? entry.code[0] + " " : " " + entry.code[1] } : entry)}`);
        const content = row.createDiv({ cls: "pw-git-change-content" });
        const checkbox = content.createEl("input", { type: "checkbox" });
        checkbox.checked = this.controller.selected.has(entry.path);
        checkbox.disabled = this.controller.busy;
        checkbox.hidden = this.controller.commitMode === "staged";
        checkbox.onchange = () => {
            if (checkbox.checked) this.controller.selected.add(entry.path); else this.controller.selected.delete(entry.path);
            this.controller.render();
        };
        const parts = entry.path.split("/");
        setIcon(content.createSpan({ cls: "pw-git-file-icon", attr: { "aria-hidden": "true" } }), fileIcon(entry.path));
        const label = content.createSpan({ cls: "pw-git-file-name", text: parts.pop() });
        this.fileLabelId = (this.fileLabelId ?? 0) + 1;
        label.id = `pw-git-file-${this.leaf.id}-${this.fileLabelId}`;
        checkbox.setAttribute("aria-labelledby", label.id);
        row.setAttribute("aria-labelledby", label.id);
        const path = parts.join("\\");
        if (entry.original) {
            const oldParts = entry.original.split("/"), oldName = oldParts.pop();
            const origin = oldParts.join("/") === parts.join("/") ? `- renamed from ${oldName}` : `- moved from ${entry.original.replaceAll("/", "\\")}`;
            content.createSpan({ cls: "pw-git-file-origin", text: origin, attr: { title: origin } });
        }
        if (this.showPaths) content.createSpan({ cls: "pw-git-file-path", text: path });
        if (!stage && entry.staged && !entry.conflict) content.createSpan({ cls: "pw-git-stage-label", text: entry.code[1] !== " " ? "Partly staged" : "Staged" });
        row.setAttribute("aria-description", `${entry.original ? `${entry.original} → ` : ""}${entry.path} (${entry.code})`);
        row.onclick = event => {
            if (event.target.closest("input")) return;
            this.selectedStage = stage; this.selectActionFile(entry.path, event); row.focus({ preventScroll: true });
        };
        row.onkeydown = event => {
            if (event.target.closest("input")) return;
            this.selectedStage = stage;
            if (event.key === "F4") { event.preventDefault(); void new CommitFileActions(this.controller, [entry.path], this.contentEl.ownerDocument).open(); return; }
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "d") { event.preventDefault(); this.selectActionFile(entry.path); void this.controller.showDiff(this.selectedPaths(), false, stage); return; }
            if (event.key === "Enter") { event.preventDefault(); this.selectActionFile(entry.path); void this.controller.showDiff(this.selectedPaths(), false, stage); return; }
            if (event.key === " " && this.controller.commitMode !== "staged") { event.preventDefault(); checkbox.click(); return; }
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") { event.preventDefault(); this.actionSelection = new Set([...this.files.querySelectorAll("[data-path]")].filter(item => !stage || item.dataset.stage === stage).map(item => item.dataset.path)); this.updateActionSelection(); return; }
            if (event.key === "F10" && event.shiftKey) { event.preventDefault(); if (!this.actionSelection.has(entry.path)) this.selectActionFile(entry.path); const bounds = row.getBoundingClientRect(); this.openContextMenu(new row.ownerDocument.defaultView.MouseEvent("contextmenu", { clientX: bounds.left, clientY: bounds.bottom }), this.selectedPaths()); return; }
            const rows = [...this.files.querySelectorAll(".pw-git-change-file")].filter(item => item.checkVisibility());
            const delta = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
            if ((!delta && !["Home", "End"].includes(event.key)) || !rows.length) return;
            const position = event.key === "Home" ? 0 : event.key === "End" ? rows.length - 1 : rows.indexOf(row) + delta;
            event.preventDefault(); const next = rows[Math.max(0, Math.min(rows.length - 1, position))];
            this.selectedStage = next.dataset.stage; this.selectActionFile(next.dataset.path, event); next.focus();
        };
        row.ondblclick = event => { if (event.target !== checkbox) void this.controller.showDiff([entry.path], false, stage); };
        row.oncontextmenu = event => {
            this.selectedStage = stage;
            if (!this.actionSelection.has(entry.path)) this.selectActionFile(entry.path);
            this.updateActionSelection();
            this.openContextMenu(event, this.selectedPaths(), entry.untracked ? undefined : this.controller.changelists.forPath(entry.path));
        };
    }

    openContextMenu(event, paths, changelistId) {
        event.preventDefault(); event.stopPropagation();
        if (!changelistId) {
            const lists = new Set(this.controller.entries.filter(entry => !entry.untracked && paths.includes(entry.path)).map(entry => this.controller.changelists.forPath(entry.path)));
            if (lists.size === 1) changelistId = [...lists][0];
        }
        this.menu?.hide();
        const menu = scopeGitMenu(new Menu(), this.contentEl);
        this.menu = menu;
        addCommitMenu(menu, this.controller, paths, changelistId, this.selectedStage);
        menu.onHide(() => { if (this.menu === menu) this.menu = undefined; });
        menu.showAtMouseEvent(event);
    }

    updateButtons() {
        const disabled = this.controller.busy || !this.controller.ready || !!this.controller.error || !!this.controller.operation || this.controller.entries.some(entry => entry.conflict);
        const all = this.controller.commitMode === "staged" && this.controller.plugin.settingsStore.preferences.commitAllTracked === true && !this.controller.draft.amend;
        const hasChanges = all ? this.controller.entries.some(entry => !entry.untracked && !entry.conflict) : this.controller.commitMode === "staged" ? this.controller.entries.some(entry => entry.staged && !entry.conflict)
            : this.controller.entries.some(entry => this.controller.selected.has(entry.path));
        const canAmend = this.controller.draft.amend && !!this.controller.head;
        this.commitButton.disabled = disabled || !hasChanges && !canAmend; this.pushButton.disabled = this.commitButton.disabled;
        this.amend.disabled = this.controller.busy || !!this.controller.operation || !this.controller.head;
        this.commitMode.disabled = this.controller.busy || !!this.controller.operation;
        this.commitMode.value = this.controller.commitMode;
        const staged = this.controller.commitMode === "staged";
        this.commitAllLabel.hidden = !staged;
        this.commitAll.disabled = disabled || this.controller.draft.amend;
        this.commitAll.checked = this.controller.plugin.settingsStore.preferences.commitAllTracked === true;
        this.commitButton.textContent = all ? "Commit All" : "Commit";
        this.commitButton.title = all ? "Commit all tracked changes; unversioned files are excluded" : staged ? "Commit all staged changes" : "Commit checked files";
        this.commitHint.textContent = all ? "All tracked changes are committed, including unstaged changes. Unversioned files are excluded." : staged
            ? "Only staged changes are committed."
            : "All changes in checked files are committed.";
        this.commitHint.title = "Select rows for toolbar actions. Checkboxes determine checked-file commits. Use staged mode for partial commits.";
        this.lastCommit.disabled = this.controller.busy;
        this.historyButton.disabled = this.loadingMessages || this.controller.busy || !this.controller.ready;
        this.message.disabled = this.controller.busy;
        this.validation.textContent = this.controller.validationRequested ? this.controller.commitValidation() : "";
        const selected = this.controller.entries.filter(entry => this.actionSelection.has(entry.path));
        for (const [name, button] of this.tools) {
            button.disabled = this.controller.busy;
            if (["Rollback", "Show Diff", "Shelve Silently"].includes(name)) button.disabled ||= !this.controller.ready || !selected.length;
            if (["Stage Selected", "Unstage Selected"].includes(name)) button.disabled ||= !this.controller.ready || !selected.length || selected.some(entry => entry.conflict);
            if (["Stage Selected", "Unstage Selected"].includes(name)) button.hidden = !staged;
            if (name === "Stage Selected") button.disabled ||= !selected.some(entry => entry.untracked || entry.code[1] !== " ");
            if (name === "Stage Selected") button.disabled ||= this.selectedStage === "staged";
            if (name === "Changelists") button.disabled ||= !this.controller.ready;
            if (name === "Select Opened File in Change View") button.disabled ||= !this.controller.ready || !this.controller.entries.length;
            if (name === "Unstage Selected") button.disabled ||= !selected.some(entry => entry.staged);
            if (name === "Unstage Selected") button.disabled ||= this.selectedStage === "unstaged";
            if (name === "Shelve Silently") button.disabled ||= selected.some(entry => entry.untracked || entry.conflict || entry.worktreeRename);
            if (name === "Rollback") button.disabled ||= selected.every(entry => entry.untracked) || selected.some(entry => entry.conflict || entry.original || entry.code.includes("A"));
            button.title = button.disabled ? `${name} — ${this.controller.busy ? "Git is busy" : "Unavailable for the current repository or selection"}` : name;
            if (name === "Shelve Silently" && selected.some(entry => entry.worktreeRename)) button.title = "Stage moved files before shelving them.";
        }
        const included = all ? this.controller.entries.filter(entry => !entry.untracked) : staged ? this.controller.entries.filter(entry => entry.staged && !entry.conflict) : this.controller.entries.filter(entry => this.controller.selected.has(entry.path));
        const added = included.filter(entry => entry.untracked || entry.code[0] === "A").length;
        const modified = included.length - added;
        this.selectionSummary.empty();
        if (added) this.selectionSummary.createSpan({ cls: "pw-git-selected-added", text: `${added} added` });
        if (modified) this.selectionSummary.createSpan({ cls: "pw-git-selected-modified", text: `${modified} modified` });
    }

    tool(toolbar, label, icon, action) {
        const button = toolbar.createEl("button", { cls: "clickable-icon", attr: { type: "button", "aria-label": label, "data-tooltip-position": "bottom" } });
        setIcon(button, icon);
        button.onclick = () => void action();
        this.tools.set(label, button);
        return button;
    }

    selectedPaths() { return this.controller.entries.filter(entry => this.actionSelection.has(entry.path)).map(entry => entry.path); }

    selectActionFile(path, event = {}) {
        const paths = [...this.files.querySelectorAll(".pw-git-change-file")].filter(row => !this.selectedStage || row.dataset.stage === this.selectedStage).map(row => row.dataset.path);
        if (event.shiftKey && paths.includes(this.selectionAnchor)) {
            const first = paths.indexOf(this.selectionAnchor), last = paths.indexOf(path);
            this.actionSelection = new Set(paths.slice(Math.min(first, last), Math.max(first, last) + 1));
        } else if (event.ctrlKey || event.metaKey) {
            if (this.actionSelection.has(path)) this.actionSelection.delete(path); else this.actionSelection.add(path);
        } else this.actionSelection = new Set([path]);
        if (!event.shiftKey) this.selectionAnchor = path;
        this.updateActionSelection();
    }

    updateActionSelection() {
        for (const row of this.files.querySelectorAll(".pw-git-change-file")) {
            const selected = this.actionSelection.has(row.dataset.path) && (!this.selectedStage || row.dataset.stage === this.selectedStage);
            row.classList.toggle("is-selected", selected);
            row.setAttribute("aria-selected", String(selected));
        }
        this.updateButtons();
    }

    changelistMenu(anchor) {
        const menu = scopeGitMenu(new Menu(), this.contentEl);
        menu.addItem(item => item.setTitle("New Changelist…").onClick(() => this.controller.newChangelist()));
        const paths = this.selectedPaths();
        menu.addItem(item => item.setTitle("Move to Another Changelist…").setDisabled(!paths.length).onClick(() => this.controller.moveToChangelist(paths)));
        const ids = new Set(this.controller.entries.filter(entry => paths.includes(entry.path) && !entry.untracked).map(entry => this.controller.changelists.forPath(entry.path)));
        menu.addItem(item => item.setTitle("Edit Changelist…").setDisabled(ids.size !== 1).onClick(() => this.controller.editChangelist([...ids][0])));
        this.showMenu(menu, anchor);
    }

    showCommitOptions() {
        if (this.commitOptionsModal || this.controller.disposed) return;
        const modal = new Modal(this.app);
        this.commitOptionsModal = modal;
        modal.setTitle("Commit Options");
        modal.contentEl.createEl("p", { text: "Commit scope" });
        const select = modal.contentEl.createEl("select", { attr: { "aria-label": "Commit scope" } });
        for (const [value, text] of [["staged", "All staged changes"], ["working", "All changes in checked files"]]) select.createEl("option", { value, text });
        select.value = this.controller.commitMode;
        select.onchange = () => { this.controller.commitMode = select.value; this.controller.saveDraft(); this.controller.render(); };
        const checkLabel = modal.contentEl.createEl("label", { cls: "pw-git-amend" });
        const whitespace = checkLabel.createEl("input", { type: "checkbox" });
        whitespace.checked = this.controller.plugin.settingsStore.preferences.checkWhitespace === true;
        checkLabel.createSpan({ text: "Check whitespace errors and newly added conflict markers before commit" });
        whitespace.onchange = async () => {
            const enabled = whitespace.checked;
            whitespace.disabled = true;
            try { await this.controller.plugin.settingsStore.savePreferences({ checkWhitespace: enabled }); }
            catch (error) { new Notice(error.message); }
            finally { if (whitespace.isConnected) whitespace.disabled = false; }
        };
        modal.contentEl.createEl("p", { text: "Staged mode commits the index, including selected hunks. Checked-file mode includes unstaged changes in each checked file. Git hooks and repository signing settings remain active." });
        const settings = modal.contentEl.createEl("button", { text: "Git identity and signing settings" });
        settings.onclick = () => { modal.close(); this.app.setting.open(); this.app.setting.openTabById(this.controller.plugin.manifest.id); };
        this.commitOptionsButton.setAttribute("aria-expanded", "true");
        modal.onClose = () => {
            this.commitOptionsModal = undefined;
            this.commitOptionsButton.setAttribute("aria-expanded", "false");
            if (this.commitOptionsButton.isConnected) this.commitOptionsButton.focus();
        };
        openGitDialog(this.controller, modal);
    }

    viewOptions(anchor) {
        const menu = scopeGitMenu(new Menu(), this.contentEl);
        menu.addItem(item => item.setTitle("Show File Paths").setChecked(this.showPaths).onClick(() => { this.showPaths = !this.showPaths; this.saveViewOptions(); this.render(); }));
        menu.addItem(item => item.setTitle("Sort by Path").setChecked(this.sortByPath).onClick(() => { this.sortByPath = !this.sortByPath; this.saveViewOptions(); this.render(); }));
        menu.addItem(item => item.setTitle("Group by Directory").setChecked(this.groupDirectories).onClick(() => { this.groupDirectories = !this.groupDirectories; this.saveViewOptions(); this.render(); }));
        menu.addSeparator();
        menu.addItem(item => item.setTitle("Shelved Changes…").setIcon(iconName("git-shelve")).setDisabled(!this.controller.ready).onClick(() => void this.showShelves(anchor)));
        for (const [name, title] of [["stashes", "Stashes and Shelves…"], ["worktrees", "Worktrees…"], ["tags", "Tags…"], ["rebase", "Interactive Rebase…"], ["reset", "Reset HEAD…"], ["repositories", "Repository and Submodules…"]]) {
            menu.addItem(item => item.setTitle(title).setDisabled(this.controller.busy || !this.controller.ready).onClick(() => this.controller.openManager(name)));
        }
        this.showMenu(menu, anchor);
    }

    async showShelves(anchor) {
        const shelves = await this.controller.act(() => this.controller.repository.shelves.list());
        if (!shelves || !this.controller.views.has(this)) return;
        const menu = scopeGitMenu(new Menu(), this.contentEl);
        if (!shelves.length) menu.addItem(item => item.setTitle("No shelved changes").setDisabled(true));
        for (const shelf of shelves) {
            menu.addItem(item => item.setTitle(`${shelf.title} (${shelf.paths.length} files)`).setIcon(iconName("idea-expui-vcs-unshelve_dark.svg"))
                .onClick(() => void this.controller.restoreShelf(shelf)));
        }
        this.showMenu(menu, anchor);
    }

    async selectOpenedFile() {
        const context = getWindowContext(this.contentEl.ownerDocument);
        const location = getServiceRegistry(this.app).get("content")?.getDocument(context).location;
        const file = location ? this.app.vault.getFileByPath(location.path)
            : this.contentEl.ownerDocument === this.app.workspace.containerEl.ownerDocument ? this.controller.lastOpenedFile : undefined;
        if (!file) { new Notice("No opened file to select."); return; }
        await this.controller.refresh();
        let path;
        try { path = this.controller.repository.path(file.path); }
        catch (error) { new Notice(error.message); return; }
        const entry = this.controller.entries.find(entry => entry.path === path);
        if (!entry) { new Notice("The opened file has no Git changes."); return; }
        this.controller.collapsed.delete(entry.untracked ? "Unversioned Files" : this.controller.changelists.forPath(entry.path));
        for (const group of ["Staged", "Unstaged", "Conflicts"]) this.controller.collapsed.delete(group);
        this.actionSelection = new Set([path]);
        this.selectedStage = this.controller.commitMode === "staged" && !entry.conflict ? entry.staged ? "staged" : "unstaged" : undefined;
        this.render();
        const row = [...this.files.querySelectorAll(".pw-git-change-file")].find(row => row.dataset.path === path);
        for (let parent = row?.parentElement; parent && parent !== this.files; parent = parent.parentElement) if (parent.tagName === "DETAILS") parent.open = true;
        row?.focus({ preventScroll: true });
        row?.scrollIntoView({ block: "nearest" });
    }

    saveViewOptions() {
        void this.controller.plugin.settingsStore.savePreferences({ commitShowPaths: this.showPaths, commitSortByPath: this.sortByPath, commitGroupDirectories: this.groupDirectories }).catch(error => new Notice(error.message));
    }

    saveCollapsed() {
        void this.controller.plugin.settingsStore.savePreferences({ commitCollapsed: [...this.controller.collapsed] }).catch(error => new Notice(error.message));
    }

    showMenu(menu, anchor) {
        this.menu?.hide();
        this.menu = menu;
        menu.dom.classList.add("pw-git-message-menu");
        anchor.setAttribute("aria-expanded", "true");
        menu.onHide(() => {
            anchor.setAttribute("aria-expanded", "false");
            if (this.menu === menu) this.menu = undefined;
        });
        const bounds = anchor.getBoundingClientRect();
        menu.showAtPosition({ x: bounds.left, y: bounds.bottom + 4 });
    }

    async showMessageHistory() {
        if (this.loadingMessages || this.controller.busy || !this.controller.ready) return;
        this.loadingMessages = true;
        this.historyButton.disabled = true;
        let messages;
        try {
            messages = await this.controller.repository.messages();
        } catch (error) {
            if (this.controller.views.has(this)) new Notice(`Git: ${error.message}`);
        } finally {
            this.loadingMessages = false;
            if (this.controller.views.has(this)) this.updateButtons();
        }
        if (!messages || !this.controller.views.has(this)) return;
        const menu = scopeGitMenu(new Menu(), this.contentEl);
        if (!messages.length) menu.addItem(item => item.setTitle("No commit messages yet").setDisabled(true));
        for (const message of messages) {
            menu.addItem(item => item.setTitle(message.split(/\r?\n/)[0]).onClick(() => {
                this.controller.draft.message = message;
                this.message.value = message;
                this.controller.saveDraft(); this.updateButtons(); this.message.focus();
            }));
        }
        this.showMenu(menu, this.historyButton);
    }

    async onClose() {
        this.commitOptionsModal?.close();
        this.splitter?.dispose(); this.menu?.hide(); this.stopBorders?.(); this.stopPanelState?.(); this.moduleScope?.dispose();
        if (this.previousFocused === null) this.contentEl.removeAttribute("data-pw-panel-focused");
        else if (this.previousFocused !== undefined) this.contentEl.setAttribute("data-pw-panel-focused", this.previousFocused);
        this.controller.views.delete(this);
    }
}
