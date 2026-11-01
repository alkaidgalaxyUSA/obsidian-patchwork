import { addBranchMenu } from "../branch-menu";
import { Menu, Notice } from "obsidian";
import { iconName, setIcon } from "../utils/icons";
import { scopeModule } from "../../../utils/module-scope";
import { addHistoryCommitMenu } from "../history/menus";
import { ChangedFiles } from "./changed-files";
import { readLog, layoutGraph, readCommit } from "./utils/git-log-data";

export class GitLogPane {
    constructor(controller, parent, rename) {
        this.controller = controller;
        this.app = controller.app;
        this.history = controller.plugin.history;
        this.menus = new Set();
        this.rename = rename;
        this.filter = { ref: "HEAD", search: "", author: "", path: "", since: "", regex: false, caseSensitive: false };
        this.limit = 200;
        this.revision = 0;
        this.selectionRevision = 0;
        this.el = parent.createDiv({ cls: "pw-git-log-pane" });
        this.scope = scopeModule(this.el, "git", { surface: "log" });
        this.favorites = new Set(["HEAD"]);
        this.groupDirectories = true;
        this.rail = this.el.createDiv({ cls: "pw-git-log-rail" });
        const hideBranches = () => this.el.classList.add("is-branches-hidden");
        this.collapsedRail = this.el.createEl("button", { cls: "pw-log-collapsed-branches", text: "Branches", attr: { "aria-label": "Show Git Branches", "aria-expanded": "false", type: "button" } });
        this.collapsedRail.addEventListener("click", () => this.el.classList.remove("is-branches-hidden"));
        this.button(this.rail, "Hide Git Branches", "chevron-left", hideBranches);
        this.rail.createDiv({ cls: "pw-git-log-rail-separator", attr: { role: "separator" } });
        this.button(this.rail, "New branch", "plus", () => this.action(controller => controller.newBranch()));
        this.button(this.rail, "Update Selected", "branch-update", () => this.selectedBranchAction("update"));
        this.button(this.rail, "Delete Branch", "trash-2", () => this.selectedBranchAction("delete"));
        this.button(this.rail, "Compare with Current", "git-show-diff", () => this.selectedBranchAction("compare"));
        this.button(this.rail, "Show My Branches", "search", event => this.showMyBranches(event.currentTarget)).setAttribute("aria-pressed", "false");
        this.button(this.rail, "Fetch", "branch-fetch", () => this.action(controller => controller.network("fetch")));
        this.button(this.rail, "Mark/Unmark as Favorite", "branch-favorite", () => {
            const ref = this.selectedRef || "HEAD";
            if (this.favorites.has(ref)) this.favorites.delete(ref); else this.favorites.add(ref);
            this.renderBranches();
        });
        this.button(this.rail, "Navigate Log to Selected Branch Head", "select-opened-file", () => { this.selectRef(this.selectedRef || "HEAD", this.selectedBranch); });
        this.rail.createDiv({ cls: "pw-git-log-rail-separator", attr: { role: "separator" } });
        this.button(this.rail, "Branches Pane Settings", "settings", event => this.settings(event));
        this.rail.createDiv({ cls: "pw-git-log-rail-separator", attr: { role: "separator" } });
        this.button(this.rail, "Group by Directory", "branch-group", event => { this.groupDirectories = !this.groupDirectories; event.currentTarget.setAttribute("aria-pressed", String(this.groupDirectories)); this.renderBranches(); }).setAttribute("aria-pressed", "true");
        this.button(this.rail, "Expand All", "chevrons-up-down", () => this.tree.querySelectorAll("details").forEach(group => { group.open = true; }));
        this.button(this.rail, "Collapse All", "chevrons-down-up", () => this.tree.querySelectorAll("details").forEach(group => { group.open = false; }));
        const sidebar = this.el.createDiv({ cls: "pw-git-log-sidebar" });
        const branchHeader = sidebar.createDiv({ cls: "pw-log-branch-header" });
        branchHeader.createSpan({ text: "Branches" });
        this.branchSearch = this.input(sidebar, "Branch or tag", () => this.renderBranches());
        this.tree = sidebar.createDiv({ cls: "pw-git-log-tree" });
        const center = this.el.createDiv({ cls: "pw-git-log-center" });
        const toolbar = center.createDiv({ cls: "pw-git-log-filters" });
        const searchBox = toolbar.createDiv({ cls: "pw-log-search-box" });
        this.search = this.input(searchBox, "Text or hash", () => this.scheduleRefresh());
        this.search.classList.add("pw-log-search");
        this.regex = this.toggle(searchBox, ".*", "Regular expression", "regex");
        this.caseToggle = this.toggle(searchBox, "Cc", "Match case", "caseSensitive");
        const branchFilter = toolbar.createDiv({ cls: "pw-log-branch-filter" });
        this.refButton = this.filterButton(branchFilter, "HEAD", "Branch filter", event => this.branchFilter(event), false);
        this.clearRefButton = this.button(branchFilter, "Clear branch filter", "x", () => this.selectRef(""));
        this.author = { value: "" }; this.date = { value: "" }; this.path = { value: "" };
        this.authorButton = this.filterButton(toolbar, "User", "User filter", event => this.valueFilter(event, "author"));
        this.dateButton = this.filterButton(toolbar, "Date", "Date filter", event => this.valueFilter(event, "since"));
        this.pathButton = this.filterButton(toolbar, "Paths", "Paths filter", event => this.valueFilter(event, "path"));
        this.button(toolbar, "Commit Sort Order", "arrow-down-wide-narrow", event => {
            const menu = this.createMenu();
            for (const [label, order] of [["Topology", "topo"], ["Date Order", "date"], ["Reverse Order", "reverse"]]) menu.addItem(item => item.setTitle(label).setChecked((this.filter.order || "topo") === order).onClick(() => { this.filter.order = order; void this.refresh(); }));
            menu.showAtMouseEvent(event);
        });
        const actions = toolbar.createDiv({ cls: "pw-log-filter-actions" });
        this.button(actions, "Navigate to HEAD", "circle-play", () => { this.selectRef("HEAD"); });
        this.button(actions, "Refresh", "refresh-cw", () => this.refresh());
        this.button(actions, "Show Branches", "git-branch", () => { this.el.classList.remove("is-branches-hidden"); this.branchSearch.focus(); });
        this.button(actions, "View Options", "eye-expand", event => this.settings(event));
        this.button(actions, "Find", "search", () => this.search.focus());
        this.rows = center.createDiv({ cls: "pw-git-log-rows", attr: { role: "listbox", "aria-label": "Commits", tabindex: "0" } });
        this.rows.addEventListener("keydown", event => this.navigate(event));
        this.rows.addEventListener("scroll", () => this.scheduleRows());
        this.resizeObserver = new ResizeObserver(() => this.scheduleRows());
        this.resizeObserver.observe(this.rows);
        this.more = center.createEl("button", { cls: "pw-git-log-more", text: "Load more" });
        this.more.addEventListener("click", () => { this.limit += 200; void this.refresh(); });
        const right = this.el.createDiv({ cls: "pw-git-log-right" });
        this.files = right.createDiv({ cls: "pw-git-log-files" });
        this.changedFiles = new ChangedFiles(this, this.files);
        this.details = right.createDiv({ cls: "pw-git-log-details" });
        this.clearSelection();
        const changed = () => {
            this.needsRefresh = true;
            if (!this.el.hidden && !this.el.closest("[hidden]")) this.scheduleRefresh();
        };
        this.stopHistory = this.history.onChange(changed);
        this.stopSnapshots = controller.snapshots.subscribe(snapshot => {
            this.updateBranchTools();
            const signature = JSON.stringify([snapshot.ready, snapshot.branch, snapshot.error]);
            if (signature === this.repositorySignature) return;
            this.repositorySignature = signature;
            changed();
        });
    }

    filterButton(parent, text, label, handler, arrow = true) {
        const button = parent.createEl("button", { cls: "pw-log-filter", attr: { type: "button", "aria-label": label, "aria-haspopup": "menu", "aria-expanded": "false" } });
        button.createSpan({ cls: "pw-log-filter-label", text });
        if (arrow) setIcon(button.createSpan({ cls: "pw-log-filter-chevron" }), "chevron-down");
        button.addEventListener("click", handler);
        return button;
    }

    setFilterText(button, text) { button.querySelector(".pw-log-filter-label").setText(text); }

    showFilter(menu, anchor) {
        if (this.filterMenu && this.filterAnchor === anchor) { this.filterMenu.hide(); menu.hide(); return; }
        this.filterMenu?.hide(); this.filterMenu = menu; this.filterAnchor = anchor;
        anchor.setAttribute("aria-expanded", "true");
        menu.onHide(() => {
            anchor.setAttribute("aria-expanded", "false");
            if (this.filterMenu === menu) { this.filterMenu = undefined; this.filterAnchor = undefined; }
        });
        const rect = anchor.getBoundingClientRect();
        menu.showAtPosition({ x: rect.left, y: rect.bottom + 3 });
    }

    branchFilter(event) {
        if (!this.snapshot) return;
        const menu = this.createMenu();
        const choose = (parent, label, ref, icon) => parent.addItem(item => {
            item.setTitle(label);
            if (icon) item.setIcon(iconName(icon));
            item.onClick(() => this.selectRef(ref, label));
        });
        menu.addItem(item => item.setTitle("Select...").onClick(() => { this.el.classList.remove("is-branches-hidden"); this.branchSearch.focus(); }));
        menu.addItem(item => item.setTitle("All branches").setChecked(!this.filter.ref).onClick(() => this.selectRef("")));
        menu.addItem(item => item.setTitle("Favorites").setDisabled(true));
        choose(menu, "HEAD", "HEAD", "branch-favorite");
        const favorites = this.favorites;
        for (const ref of favorites) {
            if (ref === "HEAD") continue;
            choose(menu, ref.replace(/^refs\/(heads|remotes)\//, ""), ref, "branch-favorite");
        }
        menu.addSeparator();
        menu.addItem(item => {
            item.setTitle("Local"); const submenu = this.scopeSubmenu(item, menu);
            for (const branch of this.snapshot.local) choose(submenu, branch, `refs/heads/${branch}`, branch === this.snapshot.current ? "branch-favorite" : undefined);
        });
        for (const remote of this.snapshot.remotes) menu.addItem(item => {
            item.setTitle(`${remote}/...`); const submenu = this.scopeSubmenu(item, menu);
            for (const branch of this.snapshot.remote.filter(branch => branch.startsWith(remote + "/"))) choose(submenu, branch.slice(remote.length + 1), `refs/remotes/${branch}`, this.favorites.has(`refs/remotes/${branch}`) ? "branch-favorite" : undefined);
        });
        this.showFilter(menu, event.currentTarget);
    }

    scopeSubmenu(item, parent) {
        const submenu = item.setSubmenu();
        const scope = scopeModule(submenu.dom, "git", { surface: "log-menu" });
        scope.refreshTokens(this.el); parent.onHide(() => scope.dispose());
        return submenu;
    }

    async valueFilter(event, key) {
        const anchor = event.currentTarget;
        if (this.filterMenu && this.filterAnchor === anchor) { this.filterMenu.hide(); return; }
        const menu = this.createMenu();
        const mapping = { author: [this.author, this.authorButton, "User"], since: [this.date, this.dateButton, "Date"], path: [this.path, this.pathButton, "Paths"] };
        const [state, button, label] = mapping[key];
        const choose = (title, value) => menu.addItem(item => item.setTitle(title).setChecked(state.value === value).onClick(() => {
            if (key === "path") this.filter.paths = undefined;
            state.value = value; this.setFilterText(button, `${label}${value ? ": " + title : ""}`); void this.refresh();
        }));
        choose("All", "");
        if (key === "since") {
            for (const [title, value] of [["Last day", "1 day ago"], ["Last week", "1 week ago"], ["Last month", "1 month ago"], ["Last year", "1 year ago"]]) choose(title, value);
        } else {
            const input = menu.dom.createEl("input", { cls: "pw-log-menu-search", type: "search", placeholder: key === "path" ? "Repository path (Enter to apply)" : "User (Enter to apply)", attr: { "aria-label": label } });
            menu.dom.prepend(input);
            input.addEventListener("keydown", event => {
                event.stopPropagation();
                if (event.key === "Enter") { if (key === "path") this.filter.paths = undefined; state.value = input.value.trim(); this.setFilterText(button, `${label}${state.value ? ": " + state.value : ""}`); menu.hide(); void this.refresh(); }
            });
            let choices = [];
            if (key === "author") choices = [...new Set((this.commits ?? []).map(commit => commit.author))];

            if (key === "path") {
                try { choices = (await this.controller.repository.run(["ls-files", "-z"])).split("\0").filter(Boolean); }
                catch (error) { menu.hide(); if (!this.disposed) new Notice(error.message); return; }
                if (this.disposed) { menu.hide(); return; }
                choices = [...new Set(choices.flatMap(path => { const parts = path.split("/"); return parts.length > 1 ? [parts.slice(0, -1).join("/"), path] : [path]; }))];
            }
            for (const value of choices.sort()) choose(value, value);
            input.addEventListener("input", () => {
                const query = input.value.toLowerCase();
                for (const row of menu.dom.querySelectorAll(".menu-item")) row.hidden = !!query && !row.textContent.toLowerCase().includes(query);
            });
        }
        if (this.disposed) { menu.hide(); return; }
        this.showFilter(menu, anchor);
    }

    branchRows(parent, branches, prefix, remote, row, group, base = "") {
        const folders = new Map();
        for (const branch of branches) {
            const label = branch.slice(base.length);
            const slash = this.groupDirectories ? label.indexOf("/") : -1;
            if (slash >= 0) {
                const name = label.slice(0, slash);
                if (!folders.has(name)) folders.set(name, []);
                folders.get(name).push(branch); continue;
            }
            const ref = prefix + branch;
            const icon = !remote && branch === this.snapshot.current ? "branch-bookmark" : this.favorites.has(ref) ? "branch-favorite" : "branch-bookmark";
            row(parent, label, ref, icon, remote, branch);
        }
        for (const [name, refs] of folders) {
            const folder = group(parent, name, prefix + base + name, true);
            this.branchRows(folder, refs, prefix, remote, row, group, base + name + "/");
        }
    }

    updateBranchTools() {
        const local = this.snapshot?.local.includes(this.selectedBranch);
        const valid = this.selectedRef && this.selectedRef !== "HEAD" && !this.selectedRef.startsWith("refs/tags/");
        for (const [label, disabled] of [
            ["Update Selected", !valid || local && !this.snapshot.upstreams.get(this.selectedBranch)],
            ["Delete Branch", !local || this.selectedBranch === this.snapshot?.current],
            ["Compare with Current", !valid || this.selectedBranch === this.snapshot?.current],
        ]) {
            const button = this.rail.querySelector(`[aria-label="${label}"]`);
            if (button) button.disabled = !!disabled || this.controller.busy;
        }
    }

    selectedBranchAction(id) {
        if (!this.selectedBranch || !this.snapshot) return;
        return this.action(controller => controller.branchActions.run(id, this.selectedBranch, this.snapshot.current, this.selectedRemote));
    }

    async showMyBranches(button) {
        this.onlyMyBranches = !this.onlyMyBranches;
        button.setAttribute("aria-pressed", String(this.onlyMyBranches));
        if (this.onlyMyBranches) {
            try {
                const email = (await this.controller.repository.run(["config", "user.email"])).trim();
                const refs = await this.controller.repository.run(["for-each-ref", "--format=%(refname:short)%09%(authoremail)", "refs/heads"]);
                if (this.disposed) return;
                this.myBranches = new Set(refs.split(/\r?\n/).filter(line => line.split("\t")[1] === `<${email}>`).map(line => line.split("\t")[0]));
            } catch (error) {
                this.onlyMyBranches = false; button.setAttribute("aria-pressed", "false");
                if (!this.disposed) new Notice(`Could not find your branches: ${error.message}`);
            }
        }
        this.renderBranches();
    }

    createMenu() {
        const menu = new Menu();
        const scope = scopeModule(menu.dom, "git", { surface: "log-menu" });
        scope.refreshTokens(this.el);
        this.menus.add(menu);
        menu.onHide(() => { scope.dispose(); this.menus.delete(menu); });
        return menu;
    }

    button(parent, label, icon, handler) {
        const button = parent.createEl("button", { cls: "clickable-icon", attr: { "aria-label": label, type: "button" } });
        setIcon(button, icon);
        button.addEventListener("click", event => {
            if (this.disposed || this.controller.disposed) return;
            void Promise.resolve().then(() => { if (!this.disposed) return handler(event); })
                .catch(error => { if (!this.disposed) new Notice(error.message); });
        });
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

    scheduleRefresh() { if (this.disposed) return; clearTimeout(this.timer); this.timer = setTimeout(() => this.refresh(), 250); }

    async refresh() {
        if (this.disposed) return;
        clearTimeout(this.timer);
        this.needsRefresh = false;
        const revision = ++this.revision;
        const git = this.controller;
        if (!git.ready || git.disposed) {
            this.rows.setText("Git repository is unavailable. Enable Patchwork Git and initialize a repository.");
            this.more.hidden = true;
            this.clearSelection();
            return;
        }
        this.filter = { ...this.filter, search: this.search.value.trim(), author: this.author.value.trim(), path: this.path.value.trim(), since: this.date.value };
        const filterSignature = JSON.stringify(this.filter);
        if (filterSignature !== this.filterSignature) this.rows.scrollTop = 0;
        this.filterSignature = filterSignature;
        this.rows.setAttribute("aria-busy", "true");
        try {
            const [snapshot, commits] = await Promise.all([git.repository.snapshot(), readLog(this.history, this.filter, this.limit)]);
            if (this.disposed || revision !== this.revision) return;
            this.snapshot = snapshot;
            if (!this.initializedFavorites) {
                this.initializedFavorites = true;
                this.favorites.add(`refs/heads/${snapshot.current}`);
                const tracking = snapshot.upstreams.get(snapshot.current);
                if (tracking) this.favorites.add(`refs/remotes/${tracking}`);
            }
            this.commits = commits;
            this.rename(`Log: ${this.filter.ref === "HEAD" ? snapshot.current : this.refLabel || "All"}`);
            const refName = this.filter.ref === "HEAD" ? snapshot.current : this.refLabel || this.filter.ref || "All";
            const localName = refName.replace(/^refs\/(heads|remotes)\//, "");
            const remote = snapshot.remotes.find(name => localName.startsWith(name + "/"));
            this.setFilterText(this.refButton, remote ? localName.slice(remote.length + 1) : localName);
            this.refButton.title = this.filter.ref || "All branches";
            this.clearRefButton.hidden = !this.filter.ref;
            this.updateBranchTools();
            this.renderBranches();
            this.renderRows();
            this.more.hidden = commits.length < this.limit;
            this.loaded = true;
            const previous = commits.find(commit => commit.hash === this.selected?.hash);
            if (previous) void this.selectCommit(previous);
            else this.clearSelection();
        } catch (error) {
            if (this.disposed || revision !== this.revision) return;
            this.commits = undefined; this.graphLayout = undefined;
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
        if (this.disposed || !this.snapshot) return;
        const active = this.el.ownerDocument.activeElement;
        const focusedRef = this.tree.contains(active) ? active.dataset.ref : undefined;
        const focusedGroup = this.tree.contains(active) ? active.dataset.groupKey : undefined;
        const collapsed = new Set([...this.tree.querySelectorAll("details:not([open])")].map(el => el.dataset.group));
        this.tree.empty();
        const query = this.branchSearch.value.toLowerCase();
        const matches = value => value.toLowerCase().includes(query);
        const row = (parent, label, ref, icon, remote = false, branch = label) => {
            const button = parent.createEl("button", { cls: "pw-log-branch", attr: { type: "button" } });
            if (icon) setIcon(button.createSpan(), icon);
            button.createSpan({ text: label });
            button.classList.toggle("is-active", !this.selectedGroup && (this.selectedRef || "HEAD") === ref);
            button.dataset.ref = ref;
            if (icon === "branch-bookmark" || icon === "branch-favorite") button.classList.add("pw-log-ref-marker");
            button.addEventListener("click", () => {
                this.selectedRef = ref; this.selectedBranch = branch; this.selectedRemote = remote; this.selectedGroup = undefined;
                for (const other of this.tree.querySelectorAll(".pw-log-branch")) other.classList.toggle("is-active", other === button);
                for (const summary of this.tree.querySelectorAll("summary")) summary.classList.remove("is-selected-group");
                this.updateBranchTools();
                this.selectRef(ref, branch);
            });
            button.addEventListener("contextmenu", event => {
                event.preventDefault();
                const menu = this.createMenu();
                this.selectedRef = ref; this.selectedBranch = branch; this.selectedRemote = remote; this.selectedGroup = undefined;
                for (const other of this.tree.querySelectorAll(".pw-log-branch")) other.classList.toggle("is-active", other === button);
                for (const summary of this.tree.querySelectorAll("summary")) summary.classList.remove("is-selected-group");
                button.focus({ preventScroll: true });
                this.updateBranchTools();
                if (ref !== "HEAD" && !ref.startsWith("refs/tags/")) addBranchMenu(menu, this.controller, this.snapshot, branch, remote, action => this.action(() => action()));
                else menu.addItem(item => item.setTitle("Show log").onClick(() => this.selectRef(ref, branch)));
                menu.showAtMouseEvent(event);
            });
        };
        const group = (parent, name, key, folder = false) => {
            const details = parent.createEl("details", { attr: { "data-group": key } });
            details.open = !!query || !collapsed.has(key);
            const summary = details.createEl("summary", { attr: { "data-group-key": key } });
            summary.classList.toggle("is-selected-group", this.selectedGroup === key);
            summary.addEventListener("click", () => {
                this.selectedGroup = key;
                for (const branch of this.tree.querySelectorAll(".pw-log-branch")) branch.classList.remove("is-active");
                for (const other of this.tree.querySelectorAll("summary")) other.classList.toggle("is-selected-group", other === summary);
            });
            if (folder) setIcon(summary.createSpan(), "folder");
            summary.createSpan({ text: name });
            return details;
        };
        if (matches("HEAD Current Branch")) row(this.tree, "HEAD (Current Branch)", "HEAD", "branch-bookmark");
        const local = this.snapshot.local.filter(branch => matches(branch) && (!this.onlyMyBranches || this.myBranches?.has(branch)));
        if (local.length) {
            const parent = group(this.tree, "Local", "local");
            this.branchRows(parent, local, "refs/heads/", false, row, group);
        }
        const remotes = this.onlyMyBranches ? [] : this.snapshot.remote.filter(matches);
        if (remotes.length) {
            const parent = group(this.tree, "Remote", "remote");
            for (const remote of this.snapshot.remotes) {
                const refs = remotes.filter(ref => ref.startsWith(remote + "/"));
                if (!refs.length) continue;
                const folder = group(parent, remote, `remote/${remote}`, true);
                this.branchRows(folder, refs, "refs/remotes/", true, row, group, remote + "/");
            }
        }
        const tags = this.snapshot.tags.filter(matches);
        if (this.showTags && tags.length) {
            const parent = group(this.tree, "Tags", "tags");
            for (const tag of tags) row(parent, tag, `refs/tags/${tag}`, "tag");
        }
        if (focusedRef) [...this.tree.querySelectorAll(".pw-log-branch")].find(row => row.dataset.ref === focusedRef)?.focus({ preventScroll: true });
        else if (focusedGroup) [...this.tree.querySelectorAll("summary")].find(row => row.dataset.groupKey === focusedGroup)?.focus({ preventScroll: true });
    }

    setHistoryPaths(paths) {
        this.filter.paths = [...paths]; this.filter.ref = "";
        this.path.value = paths.length === 1 ? paths[0] : "";
        this.setFilterText(this.pathButton, `Paths: ${paths.length === 1 ? paths[0] : paths.length + " selected"}`);
        this.limit = 200; this.rows.scrollTop = 0;
        return this.refresh();
    }

    scheduleRows() {
        if (this.disposed || this.rowFrame !== undefined) return;
        this.rowFrame = this.el.ownerDocument.defaultView.requestAnimationFrame(() => {
            this.rowFrame = undefined;
            if (!this.disposed) this.renderVisibleRows();
        });
    }

    renderRows() {
        this.graphLayout = layoutGraph(this.commits);
        this.renderStart = -1;
        this.renderVisibleRows();
    }

    renderVisibleRows() {
        if (this.disposed || !this.commits || !this.graphLayout) return;
        const height = 25;
        this.rows.scrollTop = Math.min(this.rows.scrollTop, Math.max(0, this.commits.length * height - this.rows.clientHeight));
        const start = Math.max(0, Math.floor(this.rows.scrollTop / height) - 12);
        const end = Math.min(this.commits.length, Math.ceil((this.rows.scrollTop + this.rows.clientHeight) / height) + 12);
        if (start === this.renderStart && end === this.renderEnd) return;
        this.renderStart = start; this.renderEnd = end;
        const scrollTop = this.rows.scrollTop, scrollLeft = this.rows.scrollLeft;
        this.rows.empty();
        if (!this.commits.length) { this.rows.createDiv({ cls: "pw-log-empty", text: "No commits match these filters." }); return; }
        this.rows.createDiv({ attr: { "aria-hidden": "true" } }).style.height = `${start * height}px`;
        for (let index = start; index < end; index++) {
            const commit = this.commits[index];
            const row = this.rows.createDiv({ cls: "pw-log-row", attr: { role: "option", "aria-selected": "false", "data-hash": commit.hash } });
            const selected = this.selected?.hash === commit.hash;
            row.classList.toggle("is-selected", selected);
            row.setAttribute("aria-selected", String(selected));
            this.drawGraph(row, this.graphLayout.row(index), this.graphLayout.width, /(?:^|, )HEAD(?: ->|,|$)/.test(commit.refs));
            row.createSpan({ cls: "pw-log-subject", text: commit.subject });
            this.renderRefs(row, commit);
            row.createSpan({ cls: "pw-log-author-name", text: commit.author });
            row.createSpan({ cls: "pw-log-date", text: new Date(commit.date).toLocaleString(undefined, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }) });
            row.addEventListener("click", () => this.selectCommit(commit));
            row.addEventListener("contextmenu", event => {
                event.preventDefault();
                void this.selectCommit(commit);
                const menu = this.createMenu();
                addHistoryCommitMenu(menu, this, commit);
                menu.showAtMouseEvent(event);
            });
        }
        this.rows.createDiv({ attr: { "aria-hidden": "true" } }).style.height = `${(this.commits.length - end) * height}px`;
        this.rows.scrollTop = scrollTop; this.rows.scrollLeft = scrollLeft;
    }

    renderRefs(row, commit) {
        const refs = commit.history.refs;
        if (!refs.length) return;
        const host = row.createSpan({ cls: "pw-log-refs", attr: { "aria-label": commit.refs } });
        host.title = commit.refs;
        const stack = host.createSpan({ cls: "pw-log-ref-stack", attr: { "aria-hidden": "true" } });
        const colors = ["#b18ae8", "#79b8d7", "#e5c160"];
        refs.forEach((ref, index) => {
            const marker = stack.createSpan({ cls: "pw-log-ref-bookmark" });
            marker.style.color = colors[index % colors.length];
            setIcon(marker, ref.type === "tag" ? "tag" : "log-bookmark");
        });
        const names = [...new Set(refs.map(ref => ref.name))];
        const current = refs.find(ref => ref.current)?.name;
        const remote = current && names.find(name => this.snapshot.remotes.some(remote => name === `${remote}/${current}`));
        const text = remote ? [...names.filter(name => name !== current && name !== remote), `${remote.slice(0, -current.length - 1)} & ${current}`].join(", ") : names.join(", ");
        host.createSpan({ cls: "pw-log-ref-names", text });
    }

    drawGraph(row, graph, width, head = false) {
        const doc = row.ownerDocument;
        const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("width", String(width)); svg.setAttribute("height", "25");
        svg.setAttribute("viewBox", `0 ${graph.offset} ${width} 25`);
        svg.classList.add("pw-log-graph");
        const colors = ["#7875d7", "#b59648", "#62a78b", "#4788ff", "#bd77ad"];
        for (const edge of graph.paths) {
            const path = doc.createElementNS(svg.namespaceURI, "path");
            path.setAttribute("d", edge.d); path.setAttribute("fill", "none");
            path.setAttribute("stroke", colors[edge.color % colors.length]); path.setAttribute("stroke-width", "1.5");
            svg.append(path);
        }
        const x = column => 12 + column * 14;
        if (head) {
            const ring = doc.createElementNS(svg.namespaceURI, "circle");
            for (const [key, value] of Object.entries({ cx: x(graph.column), cy: graph.y, r: 6, fill: "#191b1d", stroke: colors[graph.color % colors.length], "stroke-width": 1.5 })) ring.setAttribute(key, String(value));
            svg.append(ring);
        }
        const dot = doc.createElementNS(svg.namespaceURI, "circle");
        for (const [key, value] of Object.entries({ cx: x(graph.column), cy: graph.y, r: 3.5, fill: colors[graph.color % colors.length] })) dot.setAttribute(key, String(value));
        svg.append(dot); row.append(svg);
    }

    clearSelection() {
        ++this.selectionRevision;
        this.selected = undefined;
        this.changedFiles.clear(); this.details.empty();
        this.details.createDiv({ cls: "pw-log-empty", text: "Commit details" });
    }

    async selectCommit(commit) {
        if (this.disposed) return;
        const revision = ++this.selectionRevision;
        this.selected = commit;
        for (const row of this.rows.querySelectorAll(".pw-log-row")) {
            const active = row.dataset.hash === commit.hash;
            row.classList.toggle("is-selected", active);
            row.setAttribute("aria-selected", String(active));
        }
        if (this.changedFiles.commit?.hash !== commit.hash) this.changedFiles.clear("Loading changes…");
        this.details.empty();
        try {
            const detail = await readCommit(this.history, commit);
            if (this.disposed || revision !== this.selectionRevision) return;
            this.changedFiles.setCommit(commit, detail.files);
            this.details.createDiv({ cls: "pw-log-message", text: detail.message });
            const date = new Date(commit.date);
            const day = date.toLocaleDateString(undefined, { year: "numeric", month: "2-digit", day: "2-digit" });
            const time = date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
            const meta = this.details.createDiv({ cls: "pw-log-meta" });
            meta.createSpan({ cls: "pw-log-revision", text: commit.hash.slice(0, 8), attr: { title: commit.hash } });
            meta.createSpan({ text: ` ${commit.author} <${commit.authorEmail}> on ${day} at ${time}` });
            this.details.createDiv({ cls: "pw-log-meta pw-log-containing-branches", text: `In ${detail.branches.length} ${detail.branches.length === 1 ? "branch" : "branches"}: ${detail.branches.join(", ") || "None"}` });
        } catch (error) { if (!this.disposed && revision === this.selectionRevision) this.changedFiles.clear(error.message); }
    }

    async openDiff(commit, file) {
        try {
            const files = Array.isArray(file) ? file : [file];
            const path = files.length === 1 ? files[0].path : `${files.length} files`;
            const text = await this.history.git.diffCommitAgainstParent(commit.hash, [...new Set(files.flatMap(file => [file.original, file.path].filter(Boolean)))]);
            if (this.disposed || this.controller.disposed || !this.el.isConnected) return;
            const doc = this.el.ownerDocument;
            const anchors = [];
            this.app.workspace.iterateAllLeaves(leaf => {
                if (leaf.view.containerEl.ownerDocument === doc && leaf.view.containerEl.closest(".mod-root")) anchors.push(leaf);
            });
            const anchor = anchors.sort((left, right) => (right.activeTime ?? 0) - (left.activeTime ?? 0))[0];
            if (anchor) this.app.workspace.setActiveLeaf(anchor, { focus: false });
            else if (doc !== this.app.workspace.containerEl.ownerDocument) throw new Error("This window has no document group for Git Diff.");
            const leaf = this.app.workspace.getLeaf("tab");
            if (leaf.view.containerEl.ownerDocument !== doc) throw new Error("Git Diff is unavailable in this window.");
            await leaf.setViewState({ type: "patchwork-git-diff", state: { title: `${path} @ ${commit.hash.slice(0, 8)}`, text: text || "No textual changes (the file may be binary).", paths: files.map(file => file.path), revision: commit.hash }, active: true });
        } catch (error) { if (!this.disposed) new Notice(error.message); }
    }

    navigate(event) {
        if (!["ArrowDown", "ArrowUp"].includes(event.key) || !this.commits?.length) return;
        event.preventDefault();
        const index = this.commits.findIndex(commit => commit.hash === this.selected?.hash);
        const next = Math.max(0, Math.min(this.commits.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)));
        const top = next * 25;
        if (top < this.rows.scrollTop) this.rows.scrollTop = top;
        else if (top + 25 > this.rows.scrollTop + this.rows.clientHeight) this.rows.scrollTop = top + 25 - this.rows.clientHeight;
        this.renderVisibleRows();
        void this.selectCommit(this.commits[next]);
    }

    settings(event) {
        const menu = this.createMenu();
        menu.addItem(item => item.setTitle("Show Tags").setChecked(!!this.showTags).onClick(() => { this.showTags = !this.showTags; this.renderBranches(); }));
        menu.addItem(item => item.setTitle("Reset filters").onClick(() => {
            this.search.value = ""; this.author.value = ""; this.path.value = ""; this.date.value = "";
            this.setFilterText(this.authorButton, "User"); this.setFilterText(this.pathButton, "Paths"); this.setFilterText(this.dateButton, "Date");
            this.filter.paths = undefined;
            this.filter.regex = false; this.filter.caseSensitive = false;
            this.regex.setAttribute("aria-pressed", "false"); this.caseToggle.setAttribute("aria-pressed", "false");
            this.selectRef("HEAD");
        }));
        menu.showAtMouseEvent(event);
    }

    async action(run) {
        if (this.disposed || this.controller.disposed || !this.controller.ready || this.busy) return;
        if (this.el.ownerDocument !== this.app.workspace.containerEl.ownerDocument) {
            new Notice("This Git action is unavailable in this window."); return;
        }
        this.busy = true;
        try { await run(this.controller); await this.refresh(); }
        catch (error) { new Notice(error.message); }
        finally { this.busy = false; }
    }

    focus() { if (!this.loaded || this.needsRefresh) void this.refresh(); else this.scheduleRows(); }
    dispose() {
        this.disposed = true; ++this.revision; ++this.selectionRevision; clearTimeout(this.timer);
        if (this.rowFrame !== undefined) this.el.ownerDocument.defaultView.cancelAnimationFrame(this.rowFrame);
        this.resizeObserver?.disconnect(); this.stopHistory?.(); this.stopSnapshots?.();
        for (const menu of this.menus) menu.hide(); this.menus.clear(); this.scope.dispose(); this.el.remove();
    }
}
