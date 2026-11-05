import { basename } from "node:path";
import { addHistoryFileMenu } from "../history/menus";
import { confirm } from "../dialogs";
import { setIcon } from "../utils/icons";
import { fileIcon } from "../utils/file-icons";

/** The Log's changed-file tree and its selection-dependent actions. */
export class ChangedFiles {
    constructor(pane, host) {
        this.pane = pane;
        this.host = host;
        this.grouped = pane.controller.plugin.settingsStore.preferences.logFilesGrouped !== false;
        this.selected = new Set();
        const toolbar = host.createDiv({ cls: "pw-log-files-actions" });
        this.diffButton = pane.button(toolbar, "Show Diff", "git-show-diff", () => this.showDiff());
        this.revertButton = pane.button(toolbar, "Revert Selected Changes", "git-rollback", () => this.revert());
        this.historyButton = pane.button(toolbar, "History Up to Here", "history", () => this.showHistory());
        pane.button(toolbar, "View Options", "git-log-view", event => this.options(event));
        const right = toolbar.createDiv({ cls: "pw-log-files-expand" });
        pane.button(right, "Expand All", "git-expand-all", () => this.expand(true));
        pane.button(right, "Collapse All", "git-collapse-all", () => this.expand(false));
        const project = host.createDiv({ cls: "pw-git-project-heading" });
        setIcon(project.createSpan({ attr: { "aria-hidden": "true" } }), "project-module");
        this.projectName = project.createSpan();
        this.tree = host.createDiv({ cls: "pw-log-files-tree", attr: { role: "tree", "aria-label": "Changed files", "aria-multiselectable": "true" } });
        this.clear();
    }

    clear(message = "Select commit to view changes") {
        this.commit = undefined;
        this.files = [];
        this.selected.clear();
        this.anchor = undefined;
        this.tree.setAttribute("aria-label", "Changed files");
        this.projectName.setText(basename(this.pane.controller.repository.root));
        this.tree.setText(message);
        this.updateActions();
    }

    setCommit(commit, files) {
        const same = this.commit?.hash === commit.hash;
        this.commit = commit; this.files = files;
        this.tree.setAttribute("aria-label", `Changed files (${files.length})${commit.parents.length > 1 ? " · first parent" : ""}`);
        this.selected = new Set(same ? [...this.selected].filter(file => files.some(next => next.path === file.path)).map(file => files.find(next => next.path === file.path)) : []);
        this.projectName.setText(basename(this.pane.controller.repository.root));
        this.render();
    }

    render() {
        const collapsed = new Set([...this.tree.querySelectorAll("details:not([open])")].map(node => node.dataset.path));
        this.tree.empty();
        const root = { folders: new Map(), files: [] };
        for (const file of this.files) {
            const parts = this.grouped ? file.path.split("/") : [file.path];
            let parent = root;
            for (const part of parts.slice(0, -1)) {
                if (!parent.folders.has(part)) parent.folders.set(part, { folders: new Map(), files: [] });
                parent = parent.folders.get(part);
            }
            parent.files.push({ file, name: parts.at(-1) });
        }
        this.renderGroup(this.tree, root, "", collapsed);
        if (!this.files.length) this.tree.createDiv({ cls: "pw-log-empty", text: "No changed files" });
        this.updateActions();
    }

    renderGroup(host, node, path, collapsed) {
        for (const [name, folder] of [...node.folders].sort(([a], [b]) => a.localeCompare(b))) {
            const full = path + name + "/";
            const group = host.createEl("details", { cls: "pw-log-file-folder", attr: { "data-path": full, role: "none" } });
            group.open = !collapsed.has(full);
            const summary = group.createEl("summary", { attr: { role: "treeitem", "aria-expanded": String(group.open) } });
            setIcon(summary.createSpan(), "folder"); summary.createSpan({ text: name });
            group.addEventListener("toggle", () => summary.setAttribute("aria-expanded", String(group.open)));
            const children = group.createDiv({ cls: "pw-log-file-children", attr: { role: "group" } });
            this.renderGroup(children, folder, full, collapsed);
        }
        for (const { file, name } of node.files.sort((a, b) => a.name.localeCompare(b.name))) {
            const row = host.createEl("button", { cls: "pw-log-file", attr: { type: "button", role: "treeitem", "data-status": file.status[0], "data-path": file.path, "aria-selected": String(this.selected.has(file)) } });
            setIcon(row.createSpan(), fileIcon(file.path));
            row.createSpan({ cls: "pw-log-file-path", text: name });
            row.createSpan({ cls: "pw-log-file-status", text: file.status[0] });
            row.title = `${file.original ? file.original + " → " : ""}${file.path}\n${file.binary ? "Binary file" : `+${file.additions} −${file.deletions}`}`;
            row.addEventListener("click", event => this.select(file, event.ctrlKey || event.metaKey, event.shiftKey));
            row.addEventListener("dblclick", () => this.showDiff());
            row.addEventListener("keydown", event => {
                if (event.key === "Enter") { event.preventDefault(); this.select(file, false); void this.showDiff(); return; }
                if (event.key === " ") { event.preventDefault(); this.select(file, true); return; }
                if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") { event.preventDefault(); this.selected = new Set(this.files); this.updateActions(); return; }
                const rows = [...this.tree.querySelectorAll(".pw-log-file")].filter(item => item.checkVisibility());
                const index = rows.indexOf(row);
                const position = { ArrowUp: index - 1, ArrowDown: index + 1, Home: 0, End: rows.length - 1 }[event.key];
                if (position === undefined || !rows.length) return;
                event.preventDefault();
                const next = rows[Math.max(0, Math.min(rows.length - 1, position))];
                this.select(this.files.find(item => item.path === next.dataset.path), false, event.shiftKey); next.focus();
            });
            row.addEventListener("contextmenu", event => {
                event.preventDefault();
                if (!this.selected.has(file)) this.select(file, false);
                const menu = this.pane.createMenu();
                addHistoryFileMenu(menu, this.pane, this.commit, file);
                menu.showAtMouseEvent(event);
            });
        }
    }

    select(file, additive, extend = false) {
        if (!file) return;
        if (extend && this.anchor) {
            const files = [...this.tree.querySelectorAll(".pw-log-file")].filter(item => item.checkVisibility()).map(row => this.files.find(item => item.path === row.dataset.path));
            const first = files.indexOf(this.anchor), last = files.indexOf(file);
            if (first >= 0 && last >= 0) { this.selected = new Set(files.slice(Math.min(first, last), Math.max(first, last) + 1)); this.updateActions(); return; }
        }
        this.anchor = file;
        if (!additive) this.selected.clear();
        if (additive && this.selected.has(file)) this.selected.delete(file); else this.selected.add(file);
        this.updateActions();
    }

    updateActions() {
        for (const row of this.tree.querySelectorAll(".pw-log-file")) {
            const active = [...this.selected].some(file => file.path === row.dataset.path);
            row.classList.toggle("is-selected", active); row.setAttribute("aria-selected", String(active));
        }
        const unavailable = !this.pane.controller.ready || this.pane.controller.busy || !this.commit;
        this.diffButton.disabled = unavailable || !this.selected.size;
        this.revertButton.disabled = unavailable || !this.selected.size || !!this.pane.controller.operation;
        this.historyButton.disabled = unavailable;
        this.diffButton.title = this.selected.size ? "Show Diff" : "Select changed files to compare.";
        this.revertButton.title = this.pane.controller.operation ? "Finish the current Git operation first." : "Revert selected changes from this commit";
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
