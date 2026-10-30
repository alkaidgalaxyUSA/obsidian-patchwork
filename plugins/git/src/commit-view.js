import { ItemView, Menu, Notice } from "obsidian";
import { setIcon } from "../../utils/icons";
import { addCommitMenu } from "./commit-context-menu";
import { CommitSplitter } from "./commit-splitter";
import { fileStatus } from "./utils/file-status.js";

export const COMMIT_VIEW = "patchwork-git-commit";

export class CommitView extends ItemView {
    constructor(leaf, controller) { super(leaf); this.controller = controller; this.showPaths = true; this.sortByPath = false; }
    getViewType() { return COMMIT_VIEW; }
    getDisplayText() { return "Commit"; }
    getIcon() { return "git-commit-horizontal"; }

    async onOpen() {
        this.contentEl.empty();
        this.contentEl.classList.add("pw-git-commit-panel");
        const header = this.contentEl.createDiv({ cls: "pw-git-commit-header" });
        header.createSpan({ text: "Commit" });
        const toolbar = this.contentEl.createDiv({ cls: "pw-git-commit-toolbar", attr: { role: "toolbar", "aria-label": "Changes actions" } });
        this.tools = new Map();
        this.tool(toolbar, "Refresh Changes", "refresh-cw", () => this.controller.refresh());
        this.tool(toolbar, "Rollback", "git-rollback", () => this.controller.rollback(this.selectedPaths()));
        this.tool(toolbar, "Show Diff", "git-show-diff", () => this.controller.showDiff(this.selectedPaths()));
        this.tool(toolbar, "Shelve Silently", "git-shelve", () => this.controller.shelve(this.selectedPaths()));
        const optionsButton = this.tool(toolbar, "View Options", "eye", () => this.viewOptions(optionsButton));
        optionsButton.setAttribute("aria-haspopup", "menu");
        toolbar.createSpan({ cls: "pw-git-toolbar-separator", attr: { "aria-hidden": "true" } });
        this.tool(toolbar, "Select Opened File in Change View", "select-opened-file", () => this.selectOpenedFile());
        this.tool(toolbar, "Expand All", "git-expand-all", () => { this.controller.collapsed.clear(); this.controller.render(); });
        this.tool(toolbar, "Collapse All", "git-collapse-all", () => { this.controller.collapsed = new Set([...this.controller.changelists.lists.map(list => list.id), "Unversioned Files"]); this.controller.render(); });
        this.status = this.contentEl.createDiv({ cls: "pw-git-panel-status", attr: { role: "status", "aria-live": "polite" } });
        const body = this.contentEl.createDiv({ cls: "pw-git-commit-body" });
        this.files = body.createDiv({ cls: "pw-git-change-list" });
        this.files.oncontextmenu = event => this.openContextMenu(event, this.selectedPaths());
        const separator = body.createDiv({ cls: "pw-git-commit-splitter" });
        this.splitter = new CommitSplitter(body, separator);
        const footer = body.createDiv({ cls: "pw-git-commit-footer" });
        const options = footer.createDiv({ cls: "pw-git-commit-options" });
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
            const menu = new Menu();
            menu.addItem(item => item.setTitle("last commit").setChecked(true));
            this.showMenu(menu, this.lastCommit);
        };
        this.historyButton = options.createEl("button", { cls: "clickable-icon pw-git-message-history", attr: { type: "button", "aria-label": "Commit message history", "aria-haspopup": "menu", "aria-expanded": "false" } });
        setIcon(this.historyButton, "clock");
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
        this.validation = footer.createDiv({ cls: "pw-git-commit-error", attr: { role: "alert" } });
        const actions = footer.createDiv({ cls: "pw-git-commit-actions" });
        this.commitButton = actions.createEl("button", { text: "Commit", cls: "pw-git-commit-button" });
        this.pushButton = actions.createEl("button", { text: "Commit and Push..." });
        this.commitButton.onclick = () => void this.controller.commit(false);
        this.pushButton.onclick = () => void this.controller.commit(true);
        this.controller.views.add(this);
        this.render();
        void this.controller.refresh();
    }

    render() {
        if (!this.files) return;
        this.status.textContent = this.controller.error || (this.controller.busy ? "Git operation in progress…" : "");
        this.files.empty();
        const entries = [...this.controller.entries].sort((a, b) => {
            const key = entry => this.sortByPath ? entry.path : entry.path.split("/").pop();
            return key(a).localeCompare(key(b)) || a.path.localeCompare(b.path);
        });
        for (const list of this.controller.changelists.lists) {
            this.group(list.name, entries.filter(entry => !entry.untracked && this.controller.changelists.forPath(entry.path) === list.id), true, list.id);
        }
        const unversioned = entries.filter(entry => entry.untracked);
        if (unversioned.length) this.group("Unversioned Files", unversioned, false);
        if (!entries.length && !this.controller.error) this.files.createDiv({ cls: "pw-git-panel-empty", text: this.controller.ready ? "No changes" : "Loading repository…" });
        this.updateButtons();
    }

    group(name, entries, bold, changelistId) {
        const groupId = changelistId ?? name;
        const section = this.files.createDiv({ cls: "pw-git-change-group" });
        const header = section.createDiv({ cls: "pw-git-change-heading" });
        header.oncontextmenu = event => this.openContextMenu(event, entries.map(entry => entry.path), changelistId);
        const toggle = header.createEl("button", { cls: "clickable-icon", attr: { "aria-label": name, "aria-expanded": String(!this.controller.collapsed.has(groupId)) } });
        const content = header.createDiv({ cls: "pw-git-change-content" });
        const checkbox = content.createEl("input", { type: "checkbox", attr: { "aria-label": `Include ${name}` } });
        content.createEl(bold ? "strong" : "span", { text: name });
        content.createSpan({ cls: "pw-git-file-count", text: `${entries.length} ${entries.length === 1 ? "file" : "files"}` });
        const chosen = entries.filter(entry => this.controller.selected.has(entry.path)).length;
        checkbox.checked = !!entries.length && chosen === entries.length;
        checkbox.indeterminate = chosen > 0 && chosen < entries.length;
        checkbox.disabled = this.controller.busy || !entries.length;
        checkbox.onchange = () => {
            for (const entry of entries) {
                if (checkbox.checked) this.controller.selected.add(entry.path);
                else this.controller.selected.delete(entry.path);
            }
            this.controller.render();
        };
        const collapsed = this.controller.collapsed.has(groupId);
        setIcon(toggle, collapsed ? "chevron-right" : "chevron-down");
        toggle.onclick = () => {
            if (collapsed) this.controller.collapsed.delete(groupId); else this.controller.collapsed.add(groupId);
            this.render();
        };
        if (collapsed) return;
        for (const entry of entries) this.file(section, entry);
    }

    file(section, entry) {
        const row = section.createDiv({ cls: "pw-git-change-file" });
        row.dataset.path = entry.path;
        row.tabIndex = -1;
        row.classList.add(`is-${fileStatus(entry)}`);
        const content = row.createDiv({ cls: "pw-git-change-content" });
        const checkbox = content.createEl("input", { type: "checkbox", attr: { "aria-label": `Include ${entry.path}` } });
        checkbox.checked = this.controller.selected.has(entry.path);
        checkbox.disabled = this.controller.busy;
        checkbox.onchange = () => {
            if (checkbox.checked) this.controller.selected.add(entry.path); else this.controller.selected.delete(entry.path);
            this.controller.render();
        };
        const parts = entry.path.split("/");
        setIcon(content.createSpan({ cls: "pw-git-file-icon", attr: { "aria-hidden": "true" } }), "document");
        content.createSpan({ cls: "pw-git-file-name", text: parts.pop() });
        const path = parts.join("\\");
        if (this.showPaths) content.createSpan({ cls: "pw-git-file-path", text: path });
        row.setAttribute("aria-label", `${entry.original ? `${entry.original} → ` : ""}${entry.path} (${entry.code})`);
        row.ondblclick = event => { if (event.target !== checkbox) void this.controller.showDiff([entry.path]); };
        row.oncontextmenu = event => this.openContextMenu(event, [entry.path], entry.untracked ? undefined : this.controller.changelists.forPath(entry.path));
    }

    openContextMenu(event, paths, changelistId) {
        event.preventDefault(); event.stopPropagation();
        if (!changelistId) {
            const lists = new Set(this.controller.entries.filter(entry => !entry.untracked && paths.includes(entry.path)).map(entry => this.controller.changelists.forPath(entry.path)));
            if (lists.size === 1) changelistId = [...lists][0];
        }
        this.menu?.hide();
        const menu = new Menu();
        this.menu = menu;
        addCommitMenu(menu, this.controller, paths, changelistId);
        menu.onHide(() => { if (this.menu === menu) this.menu = undefined; });
        menu.showAtMouseEvent(event);
    }

    updateButtons() {
        const disabled = this.controller.busy || !this.controller.ready || !!this.controller.error || this.controller.entries.some(entry => entry.conflict);
        this.commitButton.disabled = disabled; this.pushButton.disabled = disabled;
        this.amend.disabled = this.controller.busy;
        this.lastCommit.disabled = this.controller.busy;
        this.historyButton.disabled = this.loadingMessages || this.controller.busy || !this.controller.ready;
        this.message.disabled = this.controller.busy;
        this.validation.textContent = this.controller.validationRequested ? this.controller.commitValidation() : "";
        const selected = this.controller.entries.filter(entry => this.controller.selected.has(entry.path));
        for (const [name, button] of this.tools) {
            button.disabled = this.controller.busy;
            if (["Rollback", "Show Diff", "Shelve Silently"].includes(name)) button.disabled ||= !this.controller.ready || !selected.length;
            if (name === "Shelve Silently") button.disabled ||= selected.some(entry => entry.untracked || entry.conflict);
            if (name === "Rollback") button.disabled ||= selected.every(entry => entry.untracked);
        }
        const added = selected.filter(entry => entry.untracked).length;
        const modified = selected.length - added;
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

    selectedPaths() { return this.controller.entries.filter(entry => this.controller.selected.has(entry.path)).map(entry => entry.path); }

    viewOptions(anchor) {
        const menu = new Menu();
        menu.addItem(item => item.setTitle("Show File Paths").setChecked(this.showPaths).onClick(() => { this.showPaths = !this.showPaths; this.render(); }));
        menu.addItem(item => item.setTitle("Sort by Path").setChecked(this.sortByPath).onClick(() => { this.sortByPath = !this.sortByPath; this.render(); }));
        menu.addSeparator();
        menu.addItem(item => item.setTitle("Shelved Changes…").setIcon("archive").setDisabled(!this.controller.ready).onClick(() => void this.showShelves(anchor)));
        this.showMenu(menu, anchor);
    }

    async showShelves(anchor) {
        const shelves = await this.controller.act(() => this.controller.repository.shelves.list());
        if (!shelves || !this.controller.views.has(this)) return;
        const menu = new Menu();
        if (!shelves.length) menu.addItem(item => item.setTitle("No shelved changes").setDisabled(true));
        for (const shelf of shelves) {
            menu.addItem(item => item.setTitle(`${shelf.title} (${shelf.paths.length} files)`).setIcon("archive-restore")
                .onClick(() => void this.controller.restoreShelf(shelf)));
        }
        this.showMenu(menu, anchor);
    }

    async selectOpenedFile() {
        const file = this.app.workspace.getActiveFile() ?? this.controller.lastOpenedFile ?? this.app.workspace.getMostRecentLeaf()?.view.file;
        if (!file) { new Notice("No opened file to select."); return; }
        await this.controller.refresh();
        let path;
        try { path = this.controller.repository.path(file.path); }
        catch (error) { new Notice(error.message); return; }
        const entry = this.controller.entries.find(entry => entry.path === path);
        if (!entry) { new Notice("The opened file has no Git changes."); return; }
        this.controller.collapsed.delete(entry.untracked ? "Unversioned Files" : this.controller.changelists.forPath(entry.path));
        this.render();
        const row = [...this.files.querySelectorAll(".pw-git-change-file")].find(row => row.dataset.path === path);
        row?.focus({ preventScroll: true });
        row?.scrollIntoView({ block: "nearest" });
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
        const menu = new Menu();
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

    async onClose() { this.splitter?.dispose(); this.menu?.hide(); this.controller.views.delete(this); }
}
