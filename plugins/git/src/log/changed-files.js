import { basename } from "node:path";
import { addHistoryFileMenu } from "../history/menus";
import { confirm } from "../dialogs";
import { setIcon } from "../utils/icons";
import { fileIcon } from "../utils/file-icons";

const fileKey = file => `${file.parentHash || ""}:${file.path}`;

/** The Log's changed-file tree and its selection-dependent actions. */
export class ChangedFiles {
    constructor(pane, host, options = {}) {
        this.pane = pane;
        this.host = host;
        this.optionsConfig = options;
        this.grouped = pane.controller.plugin.settingsStore.preferences.logFilesGrouped !== false;
        this.selected = new Set();
        const toolbar = host.createDiv({ cls: "pw-log-files-actions" });
        this.diffButton = pane.button(toolbar, "Show Diff", "git-show-diff", () => this.showDiff());
        this.revertButton = pane.button(toolbar, "Revert Selected Changes", "git-rollback", () => this.revert());
        this.historyButton = pane.button(toolbar, "History Up to Here", "history", () => this.showHistory());
        if (options.previewOnly) { this.revertButton.hidden = true; this.historyButton.hidden = true; }
        pane.button(toolbar, "View Options", "git-log-view", event => this.options(event));
        const right = toolbar.createDiv({ cls: "pw-log-files-expand" });
        this.expandButton = pane.button(right, "Expand All", "git-expand-all", () => this.expand(true));
        this.collapseButton = pane.button(right, "Collapse All", "git-collapse-all", () => this.expand(false));
        this.label = host.createSpan({ text: "Changed files", attr: { id: `pw-log-files-label-${crypto.randomUUID()}`, hidden: "" } });
        this.tree = host.createDiv({ cls: "pw-log-files-tree", attr: { role: "tree", "aria-labelledby": this.label.id, "aria-multiselectable": "true" } });
        this.clear();
    }

    clear(message = "", loading = false) {
        this.commit = undefined;
        this.files = [];
        this.selected.clear();
        this.selectedFolder = undefined;
        this.anchor = undefined;
        this.label.setText("Changed files");
        this.tree.setAttribute("aria-busy", String(loading));
        this.tree.setText(message);
        this.updateActions();
    }

    setCommit(commit, files) {
        const same = this.commit?.hash === commit.hash;
        this.commit = commit; this.files = files;
        this.tree.setAttribute("aria-busy", "false");
        this.label.setText(`Changed files (${files.length})`);
        this.selected = new Set(same ? [...this.selected].map(file => files.find(next => fileKey(next) === fileKey(file))).filter(Boolean) : []);
        this.anchor = undefined;
        this.render();
    }

    render() {
        const collapsed = new Set([...this.tree.querySelectorAll("details:not([open])")].map(node => node.dataset.path));
        this.tree.empty();
        if (!this.files.length) {
            this.tree.createDiv({ cls: "pw-log-empty", text: "No changed files" });
            this.updateActions();
            return;
        }
        const project = this.createFolder(this.tree, basename(this.pane.repository?.root || this.pane.controller.repository.root), "repository", collapsed, "project-module");
        project.parentElement.classList.add("pw-log-repository");
        const parents = this.commit.parents.length > 1 ? this.commit.parents : [undefined];
        for (const parentHash of parents) {
            const host = parentHash ? this.createFolder(project, `Changes against ${parentHash.slice(0, 8)}`, parentHash, collapsed, "git-commit") : project;
            const root = { folders: new Map(), files: [] };
            for (const file of this.files.filter(file => !parentHash || file.parentHash === parentHash)) {
                const parts = this.grouped ? file.path.split("/") : [file.path];
                let parent = root;
                for (const part of parts.slice(0, -1)) {
                    if (!parent.folders.has(part)) parent.folders.set(part, { folders: new Map(), files: [] });
                    parent = parent.folders.get(part);
                }
                parent.files.push({ file, name: parts.at(-1) });
            }
            this.renderGroup(host, root, parentHash ? `${parentHash}/` : "", collapsed);
            if (!root.files.length && !root.folders.size) host.createDiv({ cls: "pw-log-empty", text: "No changed files" });
        }
        this.updateActions();
    }

    createFolder(host, name, path, collapsed, icon = "folder") {
        const group = host.createEl("details", { cls: "pw-log-file-folder", attr: { "data-path": path, role: "none" } });
        group.open = !collapsed.has(path);
        const summary = group.createEl("summary", { attr: { role: "treeitem", "aria-expanded": String(group.open), "aria-selected": "false", tabindex: "0" } });
        const chevron = summary.createSpan({ cls: "pw-log-file-chevron", attr: { "aria-hidden": "true" } });
        const sync = () => {
            summary.setAttribute("aria-expanded", String(group.open));
            setIcon(chevron, group.open ? "chevron-down" : "chevron-right");
        };
        sync();
        setIcon(summary.createSpan(), icon);
        summary.createSpan({ text: name });
        group.addEventListener("toggle", sync);
        summary.addEventListener("click", event => {
            event.preventDefault();
            if (chevron.contains(event.target)) { group.open = !group.open; return; }
            this.selectedFolder = path;
            this.selected = new Set([...group.querySelectorAll(".pw-log-file")].map(row => this.files.find(file => fileKey(file) === row.dataset.fileKey)).filter(Boolean));
            this.updateActions();
            summary.classList.add("is-selected");
            summary.setAttribute("aria-selected", "true");
        });
        summary.addEventListener("dblclick", event => {
            event.preventDefault();
            if (!chevron.contains(event.target)) group.open = !group.open;
        });
        summary.addEventListener("keydown", event => {
            if (this.navigateTree(event, summary)) return;
            if (!["ArrowLeft", "ArrowRight", " ", "Enter"].includes(event.key)) return;
            event.preventDefault();
            group.open = event.key === "ArrowLeft" ? false : event.key === "ArrowRight" ? true : !group.open;
        });
        return group.createDiv({ cls: "pw-log-file-children", attr: { role: "group" } });
    }

    renderGroup(host, node, path, collapsed) {
        for (const [name, folder] of [...node.folders].sort(([a], [b]) => a.localeCompare(b))) {
            const full = path + name + "/";
            const children = this.createFolder(host, name, full, collapsed);
            this.renderGroup(children, folder, full, collapsed);
        }
        for (const { file, name } of node.files.sort((a, b) => a.name.localeCompare(b.name))) {
            const row = host.createEl("button", { cls: "pw-log-file", attr: { type: "button", role: "treeitem", "data-status": file.status[0], "data-path": file.path, "aria-selected": String(this.selected.has(file)) } });
            row.dataset.fileKey = fileKey(file);
            setIcon(row.createSpan(), fileIcon(file.path));
            row.createSpan({ cls: "pw-log-file-path", text: name });
            row.addEventListener("click", event => this.select(file, event.ctrlKey || event.metaKey, event.shiftKey));
            row.addEventListener("dblclick", () => this.showDiff());
            row.addEventListener("keydown", event => {
                if (event.key === "Enter") { event.preventDefault(); this.select(file, false); void this.showDiff(); return; }
                if (event.key === " ") { event.preventDefault(); this.select(file, true); return; }
                if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") { event.preventDefault(); this.selectedFolder = undefined; this.selected = new Set(this.files); this.updateActions(); return; }
                this.navigateTree(event, row);
            });
            row.addEventListener("contextmenu", event => {
                event.preventDefault();
                if (!this.selected.has(file)) this.select(file, false);
                const menu = this.pane.createMenu();
                if (this.optionsConfig.fileMenu) this.optionsConfig.fileMenu(menu, file);
                else addHistoryFileMenu(menu, this.pane, this.commit, file);
                menu.showAtMouseEvent(event);
            });
        }
    }

    select(file, additive, extend = false) {
        if (!file) return;
        this.selectedFolder = undefined;
        if (extend && this.anchor) {
            const files = [...this.tree.querySelectorAll(".pw-log-file")].filter(item => item.checkVisibility()).map(row => this.files.find(item => fileKey(item) === row.dataset.fileKey));
            const first = files.indexOf(this.anchor), last = files.indexOf(file);
            if (first >= 0 && last >= 0) { this.selected = new Set(files.slice(Math.min(first, last), Math.max(first, last) + 1)); this.updateActions(); return; }
        }
        this.anchor = file;
        if (!additive) this.selected.clear();
        if (additive && this.selected.has(file)) this.selected.delete(file); else this.selected.add(file);
        this.updateActions();
    }

    navigateTree(event, row) {
        const rows = [...this.tree.querySelectorAll("summary, .pw-log-file")].filter(item => item.checkVisibility());
        const index = rows.indexOf(row);
        const position = { ArrowUp: index - 1, ArrowDown: index + 1, Home: 0, End: rows.length - 1 }[event.key];
        if (position === undefined || !rows.length) return false;
        event.preventDefault();
        const next = rows[Math.max(0, Math.min(rows.length - 1, position))];
        if (next.dataset.fileKey) this.select(this.files.find(file => fileKey(file) === next.dataset.fileKey), false, event.shiftKey);
        else next.click();
        next.focus();
        return true;
    }

    updateActions() {
        for (const summary of this.tree.querySelectorAll("summary")) {
            const active = summary.parentElement.dataset.path === this.selectedFolder;
            summary.classList.toggle("is-selected", active); summary.setAttribute("aria-selected", String(active));
        }
        for (const row of this.tree.querySelectorAll(".pw-log-file")) {
            const active = !this.selectedFolder && [...this.selected].some(file => fileKey(file) === row.dataset.fileKey);
            row.classList.toggle("is-selected", active); row.setAttribute("aria-selected", String(active));
        }
        const unavailable = !this.pane.controller.ready || this.pane.controller.busy || !this.commit;
        this.expandButton.disabled = this.collapseButton.disabled = !this.tree.querySelector("details");
        this.diffButton.disabled = unavailable || !this.selected.size;
        this.revertButton.disabled = unavailable || !this.selected.size || !!this.pane.controller.operation || this.commit?.parents.length > 1;
        this.historyButton.disabled = unavailable;
        this.diffButton.title = this.selected.size ? "Show Diff" : "Select changed files to compare.";
        this.revertButton.title = this.commit?.parents.length > 1 ? "Reverting merge changes requires a mainline parent." : this.pane.controller.operation ? "Finish the current Git operation first." : "Revert selected changes from this commit";
    }

    showDiff() {
        if (!this.commit || !this.selected.size) return;
        return this.pane.openDiff(this.commit, [...this.selected]);
    }

    async revert() {
        const commit = this.commit, files = [...this.selected];
        if (!commit || !files.length) return;
        await this.pane.action(async () => {
            if (!await confirm(this.pane.controller, "Revert Selected Changes", `Reverse the changes from ${commit.hash.slice(0, 8)} in ${files.length} selected file(s)? Local changes must be committed or shelved first.`, "Revert")) return;
            if (this.pane.disposed || this.commit !== commit) return;
            await this.pane.history.git.revertCommitFiles(commit.hash, files.flatMap(file => [file.original, file.path].filter(Boolean)));
        });
    }

    async showHistory() {
        const commit = this.commit;
        if (!commit) return;
        const paths = [...this.selected].map(file => file.path);
        const doc = this.host.ownerDocument;
        const opened = await this.pane.controller.openHistory(paths, doc);
        if (this.pane.disposed || !opened || opened.disposed) return;
        const tool = this.pane.controller.logTools.get(doc);
        if (!tool) return;
        const target = paths.length ? opened : tool.add();
        target.selectRef(commit.hash, commit.hash.slice(0, 8));
    }

    options(event) {
        const menu = this.pane.createMenu();
        menu.addItem(item => item.setTitle("Group by Directory").setChecked(this.grouped).onClick(() => { this.grouped = !this.grouped; this.pane.savePreferences({ logFilesGrouped: this.grouped }); this.render(); }));
        menu.showAtMouseEvent(event);
    }

    expand(open) { this.tree.querySelectorAll("details").forEach(group => { group.open = open; }); }
}
