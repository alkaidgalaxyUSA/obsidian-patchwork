import { Menu, Notice } from "obsidian";
import { setIcon } from "../../../../utils/icons";
import { readLog, layoutGraph, readCommit, readCommitDiff } from "./utils/git-log-data";

export class GitLogPane {
    constructor(plugin, parent, rename) {
        this.plugin = plugin;
        this.app = plugin.app;
        this.rename = rename;
        this.filter = { ref: "HEAD", search: "", author: "", path: "", since: "", regex: false, caseSensitive: false };
        this.limit = 200;
        this.revision = 0;
        this.selectionRevision = 0;
        this.el = parent.createDiv({ cls: "pw-git-log-pane" });
        this.rail = this.el.createDiv({ cls: "pw-git-log-rail" });
        this.button(this.rail, "Refresh", "refresh-cw", () => this.refresh());
        this.button(this.rail, "New branch", "plus", () => this.action(controller => controller.newBranch()));
        this.button(this.rail, "Fetch", "download", () => this.action(controller => controller.network("fetch")));
        this.button(this.rail, "Show current branch", "git-branch", () => this.selectRef("HEAD"));
        this.button(this.rail, "Collapse branches", "chevrons-up", () => this.tree.querySelectorAll("details").forEach(group => { group.open = false; }));
        this.button(this.rail, "Settings", "settings", event => this.settings(event));
        const sidebar = this.el.createDiv({ cls: "pw-git-log-sidebar" });
        this.branchSearch = this.input(sidebar, "Branch or tag", () => this.renderBranches());
        this.tree = sidebar.createDiv({ cls: "pw-git-log-tree" });
        const center = this.el.createDiv({ cls: "pw-git-log-center" });
        const toolbar = center.createDiv({ cls: "pw-git-log-filters" });
        this.search = this.input(toolbar, "Text or hash", () => this.scheduleRefresh());
        this.search.classList.add("pw-log-search");
        this.regex = this.toggle(toolbar, ".*", "Regular expression", "regex");
        this.caseToggle = this.toggle(toolbar, "Cc", "Match case", "caseSensitive");
        this.refButton = toolbar.createEl("button", { cls: "pw-log-filter", text: "Branch: HEAD", attr: { "aria-label": "Branch filter" } });
        this.refButton.addEventListener("click", () => this.selectRef(""));
        this.author = this.input(toolbar, "User", () => this.scheduleRefresh());
        this.author.classList.add("pw-log-author");
        this.date = toolbar.createEl("select", { attr: { "aria-label": "Date filter" } });
        for (const [value, text] of [["", "Date"], ["1 week ago", "Last week"], ["1 month ago", "Last month"], ["1 year ago", "Last year"]]) this.date.createEl("option", { text, attr: { value } });
        this.date.addEventListener("change", () => this.refresh());
        this.path = this.input(toolbar, "Paths", () => this.scheduleRefresh());
        this.path.classList.add("pw-log-path");
        this.rows = center.createDiv({ cls: "pw-git-log-rows", attr: { role: "listbox", "aria-label": "Commits", tabindex: "0" } });
        this.rows.addEventListener("keydown", event => this.navigate(event));
        this.more = center.createEl("button", { cls: "pw-git-log-more", text: "Load more" });
        this.more.addEventListener("click", () => { this.limit += 200; void this.refresh(); });
        const right = this.el.createDiv({ cls: "pw-git-log-right" });
        this.files = right.createDiv({ cls: "pw-git-log-files" });
        this.details = right.createDiv({ cls: "pw-git-log-details" });
        this.clearSelection();
    }

    get git() { return this.app.plugins.plugins["patchwork-git"]; }

    button(parent, label, icon, handler) {
        const button = parent.createEl("button", { cls: "clickable-icon", attr: { "aria-label": label, type: "button" } });
        setIcon(button, icon);
        button.addEventListener("click", handler);
        return button;
    }

    input(parent, placeholder, change) {
        const input = parent.createEl("input", { type: "search", placeholder, attr: { "aria-label": placeholder } });
        input.addEventListener("input", change);
        return input;
    }

    toggle(parent, text, label, key) {
        const button = parent.createEl("button", { cls: "pw-log-toggle", text, attr: { "aria-label": label, "aria-pressed": "false" } });
        button.addEventListener("click", () => {
            this.filter[key] = !this.filter[key];
            button.setAttribute("aria-pressed", String(this.filter[key]));
            void this.refresh();
        });
        return button;
    }

    scheduleRefresh() { clearTimeout(this.timer); this.timer = setTimeout(() => this.refresh(), 250); }

    async refresh() {
        if (this.disposed) return;
        clearTimeout(this.timer);
        const revision = ++this.revision;
        const git = this.git;
        if (!git?.gitReady) {
            this.rows.setText("Git repository is unavailable. Enable Patchwork Git and initialize a repository.");
            this.more.hidden = true;
            this.clearSelection();
            return;
        }
        this.filter = { ...this.filter, search: this.search.value.trim(), author: this.author.value.trim(), path: this.path.value.trim(), since: this.date.value };
        this.rows.setAttribute("aria-busy", "true");
        try {
            const [snapshot, commits] = await Promise.all([git.repository.snapshot(), readLog(git.repository, this.filter, this.limit)]);
            if (this.disposed || revision !== this.revision) return;
            this.snapshot = snapshot;
            this.commits = commits;
            this.rename(`Log: ${this.filter.ref === "HEAD" ? snapshot.current : this.refLabel || "All"}`);
            this.refButton.setText(`Branch: ${this.filter.ref === "HEAD" ? snapshot.current : this.refLabel || "All"}${this.filter.ref ? " ×" : ""}`);
            this.renderBranches();
            this.renderRows();
            this.more.hidden = commits.length < this.limit;
            this.loaded = true;
            const previous = commits.find(commit => commit.hash === this.selected?.hash);
            if (previous) void this.selectCommit(previous);
            else this.clearSelection();
        } catch (error) {
            if (this.disposed || revision !== this.revision) return;
            this.rows.setText(error.message);
            this.more.hidden = true;
            this.clearSelection();
        } finally { if (revision === this.revision) this.rows.removeAttribute("aria-busy"); }
    }

    selectRef(ref, label) {
        this.filter.ref = ref;
        this.refLabel = label;
        this.limit = 200;
        void this.refresh();
    }

    renderBranches() {
        if (!this.snapshot) return;
        const collapsed = new Set([...this.tree.querySelectorAll("details:not([open])")].map(el => el.dataset.group));
        this.tree.empty();
        const query = this.branchSearch.value.toLowerCase();
        const matches = value => value.toLowerCase().includes(query);
        const row = (parent, label, ref, icon, remote = false, branch = label) => {
            const button = parent.createEl("button", { cls: "pw-log-branch", attr: { type: "button" } });
            setIcon(button.createSpan(), icon);
            button.createSpan({ text: label });
            button.classList.toggle("is-active", this.filter.ref === ref);
            button.addEventListener("click", () => this.selectRef(ref, branch));
            button.addEventListener("contextmenu", event => {
                event.preventDefault();
                const menu = new Menu();
                menu.addItem(item => item.setTitle("Show log").onClick(() => this.selectRef(ref, branch)));
                if (ref !== "HEAD") menu.addItem(item => item.setTitle("Checkout").onClick(() => this.action(controller => controller.checkout(ref.startsWith("refs/heads/") || remote ? branch : ref, remote))));
                menu.addItem(item => item.setTitle("Copy reference").onClick(() => navigator.clipboard.writeText(branch)));
                menu.showAtMouseEvent(event);
            });
        };
        const group = (parent, name, key, folder = false) => {
            const details = parent.createEl("details", { attr: { "data-group": key } });
            details.open = !!query || !collapsed.has(key);
            const summary = details.createEl("summary");
            if (folder) setIcon(summary.createSpan(), "folder");
            summary.createSpan({ text: name });
            return details;
        };
        if (matches("HEAD Current Branch")) row(this.tree, "HEAD (Current Branch)", "HEAD", "git-commit-horizontal");
        const local = this.snapshot.local.filter(matches);
        if (local.length) {
            const parent = group(this.tree, "Local", "local");
            for (const branch of local) row(parent, branch, `refs/heads/${branch}`, branch === this.snapshot.current ? "tag" : "git-branch");
        }
        const remotes = this.snapshot.remote.filter(matches);
        if (remotes.length) {
            const parent = group(this.tree, "Remote", "remote");
            for (const remote of this.snapshot.remotes) {
                const refs = remotes.filter(ref => ref.startsWith(remote + "/"));
                if (!refs.length) continue;
                const folder = group(parent, remote, `remote/${remote}`, true);
                for (const branch of refs) row(folder, branch.slice(remote.length + 1), `refs/remotes/${branch}`, "git-branch", true, branch);
            }
        }
        const tags = this.snapshot.tags.filter(matches);
        if (this.showTags && tags.length) {
            const parent = group(this.tree, "Tags", "tags");
            for (const tag of tags) row(parent, tag, `refs/tags/${tag}`, "tag");
        }
    }

    renderRows() {
        this.rows.empty();
        if (!this.commits.length) { this.rows.createDiv({ cls: "pw-log-empty", text: "No commits match these filters." }); return; }
        const graph = layoutGraph(this.commits);
        const width = Math.max(28, ...graph.map(row => Math.max(row.before, row.after) * 14 + 12));
        this.commits.forEach((commit, index) => {
            const row = this.rows.createDiv({ cls: "pw-log-row", attr: { role: "option", "aria-selected": "false", "data-hash": commit.hash } });
            this.drawGraph(row, graph[index], width);
            row.createSpan({ cls: "pw-log-subject", text: commit.subject });
            if (commit.refs) row.createSpan({ cls: "pw-log-refs", text: commit.refs });
            row.createSpan({ cls: "pw-log-author-name", text: commit.author });
            row.createSpan({ cls: "pw-log-date", text: new Date(commit.date).toLocaleString(undefined, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }) });
            row.addEventListener("click", () => this.selectCommit(commit));
            row.addEventListener("contextmenu", event => {
                event.preventDefault();
                void this.selectCommit(commit);
                const menu = new Menu();
                menu.addItem(item => item.setTitle("Copy revision").onClick(() => navigator.clipboard.writeText(commit.hash)));
                menu.addItem(item => item.setTitle("Copy commit message").onClick(async () => {
                    try { const detail = await readCommit(this.git.repository, commit); await navigator.clipboard.writeText(detail.message); }
                    catch (error) { new Notice(error.message); }
                }));
                menu.showAtMouseEvent(event);
            });
        });
    }

    drawGraph(row, graph, width) {
        const doc = row.ownerDocument;
        const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("width", String(width)); svg.setAttribute("height", "25");
        svg.classList.add("pw-log-graph");
        const colors = ["#7875d7", "#b59648", "#62a78b", "#4788ff", "#bd77ad"];
        const line = (x1, y1, x2, y2, color) => {
            const path = doc.createElementNS(svg.namespaceURI, "path");
            path.setAttribute("d", `M${x1} ${y1} L${x2} ${y2}`);
            path.setAttribute("stroke", color); path.setAttribute("stroke-width", "1.5");
            svg.append(path);
        };
        const x = column => 12 + column * 14;
        line(x(graph.column), 0, x(graph.column), 12, colors[graph.column % colors.length]);
        for (const edge of graph.edges) line(x(edge.from), edge.through ? 0 : 12, x(edge.to), 25, colors[edge.from % colors.length]);
        const dot = doc.createElementNS(svg.namespaceURI, "circle");
        for (const [key, value] of Object.entries({ cx: x(graph.column), cy: 12, r: 3.5, fill: colors[graph.column % colors.length] })) dot.setAttribute(key, String(value));
        svg.append(dot); row.append(svg);
    }

    clearSelection() {
        ++this.selectionRevision;
        this.selected = undefined;
        this.files.empty(); this.details.empty();
        this.files.createDiv({ cls: "pw-log-empty", text: "Select commit to view changes" });
        this.details.createDiv({ cls: "pw-log-empty", text: "Commit details" });
    }

    async selectCommit(commit) {
        const revision = ++this.selectionRevision;
        this.selected = commit;
        for (const row of this.rows.children) {
            const active = row.dataset.hash === commit.hash;
            row.classList.toggle("is-selected", active);
            row.setAttribute("aria-selected", String(active));
        }
        this.files.setText("Loading changes…"); this.details.empty();
        try {
            const detail = await readCommit(this.git.repository, commit);
            if (this.disposed || revision !== this.selectionRevision) return;
            this.files.empty();
            this.files.createDiv({ cls: "pw-log-section-title", text: `Changed files (${detail.files.length})${commit.parents.length > 1 ? " · first parent" : ""}` });
            for (const file of detail.files) {
                const row = this.files.createEl("button", { cls: "pw-log-file", attr: { type: "button", "data-status": file.status[0] } });
                setIcon(row.createSpan(), "file");
                row.createSpan({ cls: "pw-log-file-path", text: file.original ? `${file.original} → ${file.path}` : file.path });
                row.createSpan({ cls: "pw-log-file-status", text: file.status[0] });
                row.addEventListener("click", () => this.openDiff(commit, file));
            }
            if (!detail.files.length) this.files.createDiv({ cls: "pw-log-empty", text: "No changed files" });
            this.details.createDiv({ cls: "pw-log-section-title", text: commit.hash.slice(0, 12) });
            this.details.createDiv({ cls: "pw-log-meta", text: `${commit.author} · ${new Date(commit.date).toLocaleString()}` });
            this.details.createDiv({ cls: "pw-log-message", text: detail.message });
        } catch (error) { if (!this.disposed && revision === this.selectionRevision) this.files.setText(error.message); }
    }

    async openDiff(commit, file) {
        try {
            const text = await readCommitDiff(this.git.repository, commit, file);
            if (this.disposed) return;
            await this.app.workspace.getLeaf("tab").setViewState({ type: "patchwork-git-diff", state: { title: `${file.path} @ ${commit.hash.slice(0, 7)}`, text: text || "No textual changes (the file may be binary)." }, active: true });
        } catch (error) { new Notice(error.message); }
    }

    navigate(event) {
        if (!["ArrowDown", "ArrowUp"].includes(event.key) || !this.commits?.length) return;
        event.preventDefault();
        const index = this.commits.findIndex(commit => commit.hash === this.selected?.hash);
        const next = Math.max(0, Math.min(this.commits.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)));
        void this.selectCommit(this.commits[next]);
        this.rows.children[next]?.scrollIntoView({ block: "nearest" });
    }

    settings(event) {
        const menu = new Menu();
        menu.addItem(item => item.setTitle("Show Tags").setChecked(!!this.showTags).onClick(() => { this.showTags = !this.showTags; this.renderBranches(); }));
        menu.addItem(item => item.setTitle("Reset filters").onClick(() => {
            this.search.value = ""; this.author.value = ""; this.path.value = ""; this.date.value = "";
            this.filter.regex = false; this.filter.caseSensitive = false;
            this.regex.setAttribute("aria-pressed", "false"); this.caseToggle.setAttribute("aria-pressed", "false");
            this.selectRef("HEAD");
        }));
        menu.showAtMouseEvent(event);
    }

    async action(run) {
        if (!this.git?.gitReady || this.busy) return;
        this.busy = true;
        try { await run(this.git.controller); await this.refresh(); }
        catch (error) { new Notice(error.message); }
        finally { this.busy = false; }
    }

    focus() { if (!this.loaded) void this.refresh(); }
    dispose() { this.disposed = true; ++this.revision; ++this.selectionRevision; clearTimeout(this.timer); this.el.remove(); }
}
