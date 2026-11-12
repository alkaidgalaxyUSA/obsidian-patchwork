import { addBranchMenu } from "../branch-menu";
import { Menu, Notice } from "obsidian";
import { shell } from "electron";
import { iconName, setIcon } from "../utils/icons";
import { scopeModule } from "../../../utils/module-scope";
import { addHistoryCommitMenu } from "../history/menus";
import { ChangedFiles } from "./changed-files";
import { openGitDialog } from "../utils/portals";
import { readLog, layoutGraph, readCommit } from "./utils/git-log-data";
import { PanelSplitter } from "../utils/panel-splitter";
import { confirm, prompt } from "../dialogs";
import { topologicalCommits } from "../history/utils/graph-layout";
import { renderRefIcon } from "./utils/ref-icon";
import { readMyBranches } from "./utils/my-branches";
import { isProtectedRemoteBranch } from "../utils/branch-protection";
import { renderBranchSync } from "../ui/branch-sync";
import { branchFolder } from "../utils/branch-tree-model";

export class GitLogPane {
    constructor(controller, parent, rename, initialFilter) {
        this.controller = controller;
        this.app = controller.app;
        this.history = controller.plugin.history;
        this.menus = new Set();
        this.rename = rename;
        this.filter = { ref: "HEAD", search: "", author: "", path: "", since: "", regex: false, caseSensitive: false };
        this.limit = 200;
        this.revision = 0;
        this.selectionRevision = 0;
        this.accessibilityId = `pw-git-log-${crypto.randomUUID()}`;
        this.el = parent.createDiv({ cls: "pw-git-log-pane" });
        this.scope = scopeModule(this.el, "git", { surface: "log" });
        const preferences = controller.plugin.settingsStore.preferences;
        const savedFilter = initialFilter ?? preferences.logFilters?.[controller.repository.root];
        if (savedFilter && typeof savedFilter === "object") {
            for (const key of ["ref", "search", "author", "path", "since", "order"]) if (typeof savedFilter[key] === "string") this.filter[key] = savedFilter[key];
            for (const key of ["regex", "caseSensitive"]) this.filter[key] = savedFilter[key] === true;
            if (Array.isArray(savedFilter.paths)) this.filter.paths = savedFilter.paths.filter(path => typeof path === "string");
        }
        this.favorites = new Set(Array.isArray(preferences.logFavorites) ? preferences.logFavorites : ["HEAD"]);
        this.initializedFavorites = Array.isArray(preferences.logFavorites);
        this.groupDirectories = preferences.logGroupDirectories !== false;
        this.showTags = !!preferences.logShowTags;
        this.selectedHashes = new Set();
        this.splitters = [];
        this.rail = this.el.createDiv({ cls: "pw-git-log-rail" });
        this.el.classList.toggle("is-branches-hidden", preferences.logBranchesHidden === true);
        const hideBranches = () => { this.el.classList.add("is-branches-hidden"); this.savePreferences({ logBranchesHidden: true }); };
        this.collapsedRail = this.el.createEl("button", { cls: "pw-log-collapsed-branches", text: "Branches", attr: { "aria-label": "Show Git Branches", "aria-expanded": "false", type: "button" } });
        this.collapsedRail.addEventListener("click", () => this.showBranches());
        this.button(this.rail, "Hide Git Branches", "chevron-left", hideBranches);
        this.rail.createDiv({ cls: "pw-git-log-rail-separator", attr: { role: "separator" } });
        this.button(this.rail, "New branch", "plus", () => this.action(controller => controller.newBranch()));
        this.button(this.rail, "Update", "branch-update", () => this.action(controller => controller.updateProject(this.el.ownerDocument)));
        this.button(this.rail, "Delete Branch", "delete", () => this.selectedBranchAction("delete"));
        this.button(this.rail, "Compare with Current", "git-show-diff", () => this.selectedBranchAction("compare"));
        this.myBranchesButton = this.button(this.rail, "Show My Branches", "search", () => this.showMyBranches());
        this.myBranchesButton.setAttribute("aria-pressed", "false");
        this.button(this.rail, "Fetch", "branch-fetch", () => this.action(controller => controller.network("fetch", undefined, undefined, this.el.ownerDocument)));
        this.button(this.rail, "Mark/Unmark as Favorite", "idea/expui/nodes/star_dark.svg", () => {
            const ref = this.selectedRef || "HEAD";
            if (this.favorites.has(ref)) this.favorites.delete(ref); else this.favorites.add(ref);
            this.savePreferences({ logFavorites: [...this.favorites] });
            this.renderBranches();
        });
        this.button(this.rail, "Navigate Log to Selected Branch Head", "git-log-locate", () => { this.selectRef(this.selectedRef || "HEAD", this.selectedBranch); });
        this.rail.createDiv({ cls: "pw-git-log-rail-separator", attr: { role: "separator" } });
        this.button(this.rail, "Branches Pane Settings", "settings", event => this.branchSettings(event));
        this.button(this.rail, "Expand All", "git-expand-all", () => this.tree.querySelectorAll("details").forEach(group => { group.open = true; }));
        this.button(this.rail, "Collapse All", "git-collapse-all", () => this.tree.querySelectorAll("details").forEach(group => { group.open = false; }));
        const sidebar = this.el.createDiv({ cls: "pw-git-log-sidebar" });
        this.branchSearch = this.input(sidebar, "Branch or tag", () => this.renderBranches());
        this.tree = sidebar.createDiv({ cls: "pw-git-log-tree" });
        const leftGrip = this.el.createDiv({ cls: "pw-git-log-left-grip" });
        this.splitters.push(new PanelSplitter(this.el, leftGrip, sidebar, "x", preferences.logSidebarWidth || 220, size => this.savePreferences({ logSidebarWidth: size })));
        const center = this.el.createDiv({ cls: "pw-git-log-center" });
        const toolbar = center.createDiv({ cls: "pw-git-log-filters" });
        const searchBox = toolbar.createDiv({ cls: "pw-log-search-box" });
        this.search = this.input(searchBox, "Text or hash", () => this.scheduleRefresh());
        this.search.classList.add("pw-log-search");
        this.regex = this.toggle(searchBox, "git-log-regex", "Regular expression", "regex");
        this.caseToggle = this.toggle(searchBox, "git-log-match-case", "Match case", "caseSensitive");
        const branchFilter = toolbar.createDiv({ cls: "pw-log-branch-filter" });
        this.refButton = this.filterButton(branchFilter, "HEAD", "Branch filter", event => this.branchFilter(event), false);
        this.refButton.removeAttribute("aria-label");
        this.refButton.prepend(this.refButton.createSpan({ cls: "pw-log-filter-prefix", text: "Branch: " }));
        this.clearRefButton = this.button(branchFilter, "Clear branch filter", "git-log-close", () => this.selectRef(""));
        this.search.value = this.filter.search;
        this.author = { value: this.filter.author }; this.date = { value: this.filter.since }; this.path = { value: this.filter.path };
        this.authorButton = this.filterButton(toolbar, "User", "User filter", event => this.valueFilter(event, "author"));
        this.dateButton = this.filterButton(toolbar, "Date", "Date filter", event => this.valueFilter(event, "since"));
        this.pathButton = this.filterButton(toolbar, "Paths", "Paths filter", event => this.valueFilter(event, "path"));
        this.button(toolbar, "Commit Sort Order", "git-log-sort", event => {
            const menu = this.createMenu();
            for (const [label, order] of [["Topology", "topo"], ["Date Order", "date"], ["Reverse Order", "reverse"]]) menu.addItem(item => item.setTitle(label).setChecked((this.filter.order || "topo") === order).onClick(() => { this.filter.order = order; void this.refresh(); }));
            menu.showAtMouseEvent(event);
        });
        const actions = toolbar.createDiv({ cls: "pw-log-filter-actions" });
        this.button(actions, "Navigate to HEAD", "git-log-locate", () => { this.selectRef("HEAD"); });
        this.button(actions, "Refresh", "git-log-refresh", () => this.refresh());
        this.button(actions, "Show Branches", "git-branch-flipped", () => this.showBranches());
        this.button(actions, "View Options", "git-log-view", event => this.settings(event));
        this.button(actions, "Go to Hash or Reference", "search", () => this.goToRef());
        this.rows = center.createDiv({ cls: "pw-git-log-rows", attr: { role: "listbox", "aria-label": "Commits", "aria-multiselectable": "true", tabindex: "0" } });
        this.rows.addEventListener("keydown", event => this.navigate(event));
        this.rows.addEventListener("scroll", () => this.scheduleRows());
        this.resizeObserver = new ResizeObserver(() => this.scheduleRows());
        this.resizeObserver.observe(this.rows);
        this.more = center.createEl("button", { cls: "pw-git-log-more", text: "Load more" });
        this.more.addEventListener("click", () => void this.loadMore());
        const rightGrip = this.el.createDiv();
        const right = this.el.createDiv({ cls: "pw-git-log-right" });
        this.splitters.push(new PanelSplitter(this.el, rightGrip, right, "x", preferences.logDetailsWidth || 260, size => this.savePreferences({ logDetailsWidth: size }), true));
        this.files = right.createDiv({ cls: "pw-git-log-files" });
        this.changedFiles = new ChangedFiles(this, this.files);
        const detailsGrip = right.createDiv();
        this.details = right.createDiv({ cls: "pw-git-log-details" });
        this.splitters.push(new PanelSplitter(right, detailsGrip, this.details, "y", preferences.logDetailsHeight || 140, size => this.savePreferences({ logDetailsHeight: size }), true));
        this.detailsGrip = detailsGrip;
        this.showDetails = preferences.logShowDetails !== false;
        this.details.hidden = this.detailsGrip.hidden = !this.showDetails;
        this.showAuthor = preferences.logShowAuthor !== false;
        this.showDate = preferences.logShowDate !== false;
        this.el.classList.toggle("is-author-hidden", !this.showAuthor);
        this.el.classList.toggle("is-date-hidden", !this.showDate);
        this.clearSelection();
        const changed = () => {
            this.needsRefresh = true;
            if (!this.el.hidden && !this.el.closest("[hidden]")) this.scheduleRefresh();
        };
        this.stopHistory = this.history.onChange(changed);
        this.stopSnapshots = controller.snapshots.subscribe(snapshot => {
            this.updateBranchTools(); this.changedFiles.updateActions();
            const signature = JSON.stringify([snapshot.ready, snapshot.branch, snapshot.error, snapshot.sync]);
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
        menu.addItem(item => item.setTitle("Select...").onClick(() => this.showBranches()));
        menu.addItem(item => item.setTitle("All branches").setChecked(!this.filter.ref).onClick(() => this.selectRef("")));
        menu.addItem(item => item.setTitle("Favorites").setDisabled(true));
        choose(menu, "HEAD", "HEAD", "idea/expui/nodes/star_dark.svg");
        const favorites = this.favorites;
        for (const ref of favorites) {
            if (ref === "HEAD") continue;
            choose(menu, ref.replace(/^refs\/(heads|remotes)\//, ""), ref, "idea/expui/nodes/star_dark.svg");
        }
        menu.addSeparator();
        menu.addItem(item => {
            item.setTitle("Local"); const submenu = this.scopeSubmenu(item, menu);
            for (const branch of this.snapshot.local) choose(submenu, branch, `refs/heads/${branch}`, branch === this.snapshot.current ? "idea/expui/nodes/star_dark.svg" : undefined);
        });
        for (const remote of this.snapshot.remotes) menu.addItem(item => {
            item.setTitle(`${remote}/...`); const submenu = this.scopeSubmenu(item, menu);
            for (const branch of this.snapshot.remote.filter(branch => branch.startsWith(remote + "/"))) choose(submenu, branch.slice(remote.length + 1), `refs/remotes/${branch}`, this.favorites.has(`refs/remotes/${branch}`) ? "idea/expui/nodes/star_dark.svg" : undefined);
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
        menu.dom.classList.add("pw-log-value-menu");
        const choose = (title, value) => menu.addItem(item => item.setTitle(title).onClick(() => {
            if (key === "path") this.filter.paths = undefined;
            state.value = value; this.setFilterText(button, `${label}${value ? ": " + title : ""}`); void this.refresh();
        }));
        choose("All", "");
        if (key === "since") {
            for (const [title, value] of [["Last day", "1 day ago"], ["Last week", "1 week ago"], ["Last month", "1 month ago"], ["Last year", "1 year ago"]]) choose(title, value);
        } else {
            let choices = [];
            if (key === "author") choices = [...new Set((this.commits ?? []).map(commit => commit.author))];

            if (key === "path") {
                try { choices = (await this.controller.repository.run(["ls-files", "-z"])).split("\0").filter(Boolean); }
                catch (error) { menu.hide(); if (!this.disposed) new Notice(error.message); return; }
                if (this.disposed) { menu.hide(); return; }
                choices = [...new Set(choices.flatMap(path => { const parts = path.split("/"); return parts.length > 1 ? [parts.slice(0, -1).join("/"), path] : [path]; }))];
            }
            for (const value of choices.sort()) choose(value, value);

        }
        if (this.disposed) { menu.hide(); return; }
        this.showFilter(menu, anchor);
    }

    branchRows(parent, branches, prefix, remote, row, group, base = "") {
        const folders = new Map();
        const nodes = [];
        for (const branch of branches) {
            const label = branch.slice(base.length);
            const folder = branchFolder(label, this.groupDirectories);
            if (folder) {
                const name = folder.name;
                if (!folders.has(name)) folders.set(name, []);
                folders.get(name).push(branch); continue;
            }
            const ref = prefix + branch;
            const favorite = this.favorites.has(ref), current = !remote && branch === this.snapshot.current;
            const icon = current ? favorite ? "idea/dvcs/currentBranchFavoriteLabel_dark.svg" : "idea/dvcs/currentBranchLabel_dark.svg"
                : favorite ? "idea/expui/nodes/star_dark.svg" : "git-branch-flipped";
            nodes.push({ label, ref, icon, branch, weight: current ? 0 : favorite ? 1 : 4 });
        }
        for (const [name, refs] of folders) {
            nodes.push({ label: name, refs, weight: refs.some(branch => this.favorites.has(prefix + branch)) ? 2 : 3 });
        }
        nodes.sort((left, right) => left.weight - right.weight || left.label.localeCompare(right.label));
        for (const node of nodes) {
            if (!node.refs) { row(parent, node.label, node.ref, node.icon, remote, node.branch); continue; }
            const folder = group(parent, node.label, prefix + base + node.label, true);
            this.branchRows(folder, node.refs, prefix, remote, row, group, base + node.label + "/");
        }
    }

    updateBranchTools() {
        const available = this.controller.ready && !this.controller.busy && !this.disposed && this.el.ownerDocument === this.app.workspace.containerEl.ownerDocument;
        const hasRemotes = !!this.snapshot?.remotes.length;
        const local = !this.selectedGroup && !this.selectedRemote && this.snapshot?.local.includes(this.selectedBranch);
        const remote = !this.selectedGroup && this.selectedRemote && this.snapshot?.remote.includes(this.selectedBranch);
        const valid = !!(local || remote) && this.selectedRef !== "HEAD";
        const current = local && this.selectedBranch === this.snapshot?.current;
        const protectedRemote = remote && isProtectedRemoteBranch(this.controller, this.selectedBranch, this.snapshot.remotes);
        const states = [
            ["Show My Branches", true, "Requires an available repository."],
            ["New branch", !!this.controller.head, "Requires an existing commit."],
            ["Update", this.snapshot?.local.includes(this.snapshot?.current), "Check out a local branch before updating.", !hasRemotes],
            ["Delete Branch", valid && !current && !protectedRemote, protectedRemote ? "This remote branch is protected by repository Git settings." : "Select a branch other than the current local branch."],
            ["Compare with Current", valid && !current, "Select another branch."],
            ["Fetch", hasRemotes, "No remotes are configured.", !hasRemotes],
            ["Mark/Unmark as Favorite", valid, "Select a branch."],
            ["Navigate Log to Selected Branch Head", valid || !this.selectedGroup && this.selectedRef === "HEAD", "Select a branch or HEAD."],
        ];
        for (const [label, enabled, reason, hidden = false] of states) {
            const button = this.rail.querySelector(`[aria-label="${label}"]`);
            if (!button) continue;
            const operationBlocked = !!this.controller.operation && ["New branch", "Update", "Delete Branch"].includes(label);
            button.hidden = hidden; button.disabled = !available || !enabled || operationBlocked;
            button.title = !available ? "Git is busy or unavailable." : operationBlocked ? "Finish or abort the current Git operation first." : enabled ? label : reason;
        }
        if (this.myBranchesRequest) this.myBranchesButton.title = "Checking complete local history; click to cancel.";
    }

    selectedBranchAction(id) {
        if (id === "update" && this.snapshot && !this.selectedGroup && (!this.selectedRef || this.selectedRef === "HEAD")) {
            return this.action(controller => controller.branchActions.run(id, this.snapshot.current, this.snapshot.current, false));
        }
        if (!this.selectedBranch || !this.snapshot) return;
        return this.action(controller => controller.branchActions.run(id, this.selectedBranch, this.snapshot.current, this.selectedRemote));
    }

    async showMyBranches() {
        this.onlyMyBranches = !this.onlyMyBranches;
        this.myBranchesButton.setAttribute("aria-pressed", String(this.onlyMyBranches));
        if (!this.onlyMyBranches) {
            this.myBranchesRequest?.abort();
            this.renderBranches();
            this.updateBranchTools();
            return;
        }
        await this.loadMyBranches();
    }

    async loadMyBranches() {
        this.myBranchesRequest?.abort();
        const request = new AbortController();
        this.myBranchesRequest = request;
        this.myBranches = undefined;
        this.tree.setText("Checking exclusive commit authors… Click Show My Branches again to cancel.");
        this.myBranchesButton.setAttribute("aria-busy", "true");
        this.myBranchesButton.title = "Checking complete local history; click to cancel.";
        try {
            const refs = await readMyBranches(this.controller.repository, request.signal);
            if (this.disposed || request.signal.aborted) return;
            this.myBranches = refs;
        } catch (error) {
            if (this.disposed || request.signal.aborted) return;
            this.onlyMyBranches = false;
            this.myBranchesButton.setAttribute("aria-pressed", "false");
            new Notice(error.message);
        } finally {
            if (!this.disposed && this.myBranchesRequest === request) {
                this.myBranchesButton.removeAttribute("aria-busy");
                this.myBranchesRequest = undefined;
                this.renderBranches(); this.updateBranchTools();
            }
        }
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
        const button = parent.createEl("button", { cls: "clickable-icon", attr: { "aria-label": label, title: label, type: "button" } });
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

    toggle(parent, icon, label, key) {
        const button = parent.createEl("button", { cls: "pw-log-toggle", attr: { "aria-label": label, title: label, "aria-pressed": String(!!this.filter[key]) } });
        setIcon(button, icon);
        button.addEventListener("click", () => {
            this.filter[key] = !this.filter[key];
            button.setAttribute("aria-pressed", String(this.filter[key]));
            void this.refresh();
        });
        return button;
    }

    scheduleRefresh() { if (this.disposed) return; clearTimeout(this.timer); this.timer = setTimeout(() => this.refresh(), 250); }

    savePreferences(values) { void this.controller.plugin.settingsStore.savePreferences(values).catch(error => { if (!this.disposed) new Notice(error.message); }); }

    async loadMore() {
        if (this.loadingMore || !this.commits || this.filter.order === "reverse") {
            if (this.filter.order === "reverse") { this.limit += 200; void this.refresh(); }
            return;
        }
        const revision = this.revision, root = this.controller.repository.root;
        this.loadingMore = true; this.more.disabled = true;
        try {
            const next = await readLog(this.history, this.filter, 200, this.commits.length);
            if (this.disposed || revision !== this.revision || root !== this.controller.repository.root) return;
            const known = new Set(this.commits.map(commit => commit.hash));
            this.commits.push(...next.filter(commit => !known.has(commit.hash)));
            this.limit = this.commits.length; this.more.hidden = next.length < 200;
            this.renderRows();
        } catch (error) { if (!this.disposed) new Notice(error.message); }
        finally { this.loadingMore = false; if (!this.disposed) this.more.disabled = false; }
    }

    async refresh() {
        if (this.disposed) return;
        clearTimeout(this.timer);
        this.needsRefresh = false;
        const revision = ++this.revision;
        const git = this.controller;
        const root = git.repository.root;
        if (this.repositoryRoot && this.repositoryRoot !== root) { this.filter.ref = "HEAD"; this.refLabel = undefined; this.limit = 200; this.clearSelection(); }
        this.repositoryRoot = root;
        if (!git.ready || git.disposed) {
            this.rows.setText("Git repository is unavailable. Enable Patchwork Git and initialize a repository.");
            this.more.hidden = true;
            this.clearSelection();
            return;
        }
        this.filter = { ...this.filter, search: this.search.value.trim(), author: this.author.value.trim(), path: this.path.value.trim(), since: this.date.value };
        const filterSignature = JSON.stringify(this.filter);
        if (filterSignature !== this.filterSignature) {
            this.rows.scrollTop = 0;
            const filters = this.controller.plugin.settingsStore.preferences.logFilters || {};
            this.savePreferences({ logFilters: { ...filters, [root]: { ...this.filter } } });
        }
        this.filterSignature = filterSignature;
        this.rows.setAttribute("aria-busy", "true");
        try {
            const [snapshot, commits] = await Promise.all([git.repository.snapshot(), readLog(this.history, this.filter, this.limit)]);
            if (this.disposed || revision !== this.revision || root !== git.repository.root) return;
            this.snapshot = snapshot;
            if (this.onlyMyBranches) await this.loadMyBranches();
            if (this.disposed || revision !== this.revision || root !== git.repository.root) return;
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
            if (previous) void this.selectCommit(previous, { preserve: true });
            else this.clearSelection();
        } catch (error) {
            if (this.disposed || revision !== this.revision) return;
            this.commits = undefined; this.graphLayout = undefined;
            this.rows.setText(error.message);
            this.more.hidden = true;
            this.clearSelection();
        } finally { if (revision === this.revision) this.rows.removeAttribute("aria-busy"); }
    }

    async goToRef() {
        const root = this.controller.repository.root;
        const ref = await prompt(this.controller, "Go to Hash or Reference", "Commit hash, branch or tag");
        if (!ref || this.disposed) return;
        const hash = (await this.controller.repository.run(["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`])).trim();
        if (this.disposed || root !== this.controller.repository.root) throw new Error("The repository changed. Reopen navigation.");
        const index = this.commits?.findIndex(commit => commit.hash === hash) ?? -1;
        if (index < 0) { this.selectRef(hash, ref); return; }
        this.rows.scrollTop = index * this.graphLayout.height; this.renderRows();
        await this.selectCommit(this.commits[index]); this.rows.focus();
    }

    selectRef(ref, label) {
        this.filter.ref = ref;
        this.refLabel = label;
        this.limit = 200;
        void this.refresh();
    }

    renderBranches() {
        if (this.disposed || !this.snapshot) return;
        if (this.onlyMyBranches && this.myBranchesRequest && !this.myBranches) return;
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
            const current = !remote && ref === `refs/heads/${this.snapshot.current}`;
            button.title = current ? `${branch} (Current branch)` : ref;
            if (current) button.setAttribute("aria-current", "true");
            if (!remote && ref.startsWith("refs/heads/")) renderBranchSync(button.createSpan({ cls: "pw-git-branch-sync" }), this.snapshot.sync?.get(branch));
            if (icon === "idea/expui/nodes/star_dark.svg") button.classList.add("pw-log-ref-marker");
            button.addEventListener("click", () => {
                this.selectedRef = ref; this.selectedBranch = branch; this.selectedRemote = remote; this.selectedGroup = undefined;
                for (const other of this.tree.querySelectorAll(".pw-log-branch")) other.classList.toggle("is-active", other === button);
                for (const summary of this.tree.querySelectorAll("summary")) summary.classList.remove("is-selected-group");
                this.updateBranchTools();
            });
            button.addEventListener("dblclick", () => this.selectRef(ref, branch));
            button.addEventListener("keydown", event => {
                if (event.key !== "Enter") return;
                event.preventDefault();
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
            summary.addEventListener("click", event => {
                event.preventDefault();
                this.selectedGroup = key;
                this.updateBranchTools();
                for (const branch of this.tree.querySelectorAll(".pw-log-branch")) branch.classList.remove("is-active");
                for (const other of this.tree.querySelectorAll("summary")) other.classList.toggle("is-selected-group", other === summary);
            });
            summary.addEventListener("dblclick", event => {
                event.preventDefault(); event.stopPropagation();
                details.open = !details.open;
                summary.setAttribute("aria-expanded", String(details.open));
            });
            summary.setAttribute("aria-expanded", String(details.open));
            summary.addEventListener("keydown", event => {
                if (!["Enter", " ", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
                event.preventDefault(); event.stopPropagation();
                details.open = event.key === "ArrowLeft" ? false : event.key === "ArrowRight" ? true : !details.open;
                summary.setAttribute("aria-expanded", String(details.open));
            });
            setIcon(summary.createSpan({ cls: "pw-log-group-chevron", attr: { "aria-hidden": "true" } }), "chevron-right");
            if (folder) setIcon(summary.createSpan({ cls: key.startsWith("remote/") ? "pw-log-remote-icon" : "", attr: { "aria-hidden": "true" } }), "folder");
            summary.createSpan({ text: name });
            return details;
        };
        if ((!this.onlyMyBranches || this.myBranches?.has(`refs/heads/${this.snapshot.current}`)) && matches("HEAD Current Branch")) row(this.tree, "HEAD (Current Branch)", "HEAD");
        const local = this.snapshot.local.filter(branch => matches(branch) && (!this.onlyMyBranches || this.myBranches?.has(`refs/heads/${branch}`)));
        if (local.length) {
            const parent = group(this.tree, "Local", "local");
            this.branchRows(parent, local, "refs/heads/", false, row, group);
        }
        const remotes = this.snapshot.remote.filter(branch => matches(branch) && (!this.onlyMyBranches || this.myBranches?.has(`refs/remotes/${branch}`)));
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
        if (!this.onlyMyBranches && this.showTags && tags.length) {
            const parent = group(this.tree, "Tags", "tags");
            for (const tag of tags) row(parent, tag, `refs/tags/${tag}`, "idea/dvcs/branchLabel_dark.svg");
        }
        if (!this.tree.childElementCount) this.tree.setText(this.onlyMyBranches ? "No branches have exclusive commits entirely authored by you." : "No matching branches.");
        if (this.selectedRef && ![...this.tree.querySelectorAll(".pw-log-branch")].some(row => row.dataset.ref === this.selectedRef)) {
            this.selectedRef = undefined; this.selectedBranch = undefined; this.selectedRemote = false;
            this.updateBranchTools();
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
        const height = this.graphLayout.height;
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
            row.id = `${this.accessibilityId}-${commit.hash}`;
            const selected = this.selectedHashes.has(commit.hash);
            row.classList.toggle("is-selected", selected);
            row.setAttribute("aria-selected", String(selected));
            this.drawGraph(row, this.graphLayout.row(index), this.graphLayout.width, /(?:^|, )HEAD(?: ->|,|$)/.test(commit.refs));
            row.createSpan({ cls: "pw-log-subject", text: commit.subject });
            this.renderRefs(row, commit);
            row.createSpan({ cls: "pw-log-author-name", text: commit.author });
            row.createSpan({ cls: "pw-log-date", text: new Date(commit.date).toLocaleString(undefined, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }) });
            row.addEventListener("click", event => this.selectCommit(commit, event));
            row.addEventListener("contextmenu", event => {
                event.preventDefault();
                if (!this.selectedHashes.has(commit.hash)) void this.selectCommit(commit);
                const menu = this.createMenu();
                if (this.selectedHashes.size > 1) {
                    menu.addItem(item => item.setTitle("Compare Selected Commits…").setDisabled(this.selectedHashes.size !== 2).onClick(() => this.compareSelection()));
                    menu.addItem(item => item.setTitle("Cherry-pick Selected…").onClick(() => void this.batch("cherry-pick")));
                    menu.addItem(item => item.setTitle("Revert Selected…").onClick(() => void this.batch("revert")));
                    menu.addSeparator();
                }
                addHistoryCommitMenu(menu, this, commit);
                menu.showAtMouseEvent(event);
            });
        }
        this.rows.createDiv({ attr: { "aria-hidden": "true" } }).style.height = `${(this.commits.length - end) * height}px`;
        this.updateActiveRow();
        this.rows.scrollTop = scrollTop; this.rows.scrollLeft = scrollLeft;
    }

    renderRefs(row, commit) {
        const refs = commit.history.refs;
        if (!refs.length) return;
        const host = row.createSpan({ cls: "pw-log-refs", attr: { "aria-label": commit.refs } });
        host.title = commit.refs;
        const stack = host.createSpan({ cls: "pw-log-ref-stack", attr: { "aria-hidden": "true" } });
        renderRefIcon(stack, refs);
        const names = [...new Set(refs.map(ref => ref.name))];
        const current = refs.find(ref => ref.current)?.name;
        const remote = current && names.find(name => this.snapshot.remotes.some(remote => name === `${remote}/${current}`));
        const text = remote ? [...names.filter(name => name !== current && name !== remote), `${remote.slice(0, -current.length - 1)} & ${current}`].join(", ") : names.join(", ");
        host.createSpan({ cls: "pw-log-ref-names", text });
    }

    drawGraph(row, graph, width, head = false) {
        const doc = row.ownerDocument;
        const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("width", String(width)); svg.setAttribute("height", String(this.graphLayout.height));
        svg.setAttribute("viewBox", `0 ${graph.offset} ${width} ${this.graphLayout.height}`);
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
            for (const [key, value] of Object.entries({ cx: x(graph.column), cy: graph.y, r: 6, fill: "var(--background-primary)", stroke: colors[graph.color % colors.length], "stroke-width": 1.5 })) ring.setAttribute(key, String(value));
            svg.append(ring);
        }
        const dot = doc.createElementNS(svg.namespaceURI, "circle");
        for (const [key, value] of Object.entries({ cx: x(graph.column), cy: graph.y, r: 3.5, fill: colors[graph.color % colors.length] })) dot.setAttribute(key, String(value));
        svg.append(dot); row.append(svg);
    }

    clearSelection() {
        this.detailsRequest?.abort();
        ++this.selectionRevision;
        this.selected = undefined;
        this.selectedHashes.clear();
        this.rows.removeAttribute("aria-activedescendant");
        this.changedFiles.clear(); this.details.empty();
        this.details.createDiv({ cls: "pw-log-empty", text: "Commit details" });
    }

    async selectCommit(commit, event = {}) {
        if (this.disposed) return;
        this.detailsRequest?.abort();
        const request = this.detailsRequest = new AbortController();
        const revision = ++this.selectionRevision;
        if (!event.preserve) {
            if (event.shiftKey && this.selectionAnchor) {
                const start = this.commits.findIndex(item => item.hash === this.selectionAnchor), end = this.commits.findIndex(item => item.hash === commit.hash);
                this.selectedHashes = new Set(this.commits.slice(Math.max(0, Math.min(start, end)), Math.max(start, end) + 1).map(item => item.hash));
            } else if (event.ctrlKey || event.metaKey) {
                if (this.selectedHashes.has(commit.hash)) this.selectedHashes.delete(commit.hash); else this.selectedHashes.add(commit.hash);
            } else this.selectedHashes = new Set([commit.hash]);
            if (!event.shiftKey) this.selectionAnchor = commit.hash;
        } else this.selectedHashes = new Set([...this.selectedHashes].filter(hash => this.commits.some(item => item.hash === hash)));
        this.selected = commit;
        this.updateActiveRow();
        for (const row of this.rows.querySelectorAll(".pw-log-row")) {
            const active = this.selectedHashes.has(row.dataset.hash);
            row.classList.toggle("is-selected", active);
            row.setAttribute("aria-selected", String(active));
        }
        this.changedFiles.clear("Loading changed files…", true);
        this.details.empty();
        if (this.selectedHashes.size !== 1) {
            this.changedFiles.clear(`${this.selectedHashes.size} commits selected`);
            this.details.createEl("strong", { text: `${this.selectedHashes.size} commits selected` });
            const compare = this.details.createEl("button", { text: "Compare Selected" }); compare.disabled = this.selectedHashes.size !== 2; compare.onclick = () => this.compareSelection();
            return;
        }
        try {
            const detail = await readCommit(this.history, commit, request.signal);
            if (this.disposed || !this.el.isConnected || request.signal.aborted || revision !== this.selectionRevision || this.repositoryRoot !== this.controller.repository.root) return;
            this.changedFiles.setCommit(commit, detail.files);
            const message = this.details.createDiv({ cls: "pw-log-message" });
            for (const part of detail.message.split(/(https?:\/\/[^\s<>]+)/g)) {
                if (!/^https?:\/\//.test(part)) { message.appendText(part); continue; }
                const link = message.createEl("a", { text: part, attr: { href: part, rel: "noopener noreferrer" } });
                link.onclick = event => { event.preventDefault(); void shell.openExternal(part).catch(error => new Notice(error.message)); };
            }
            const date = new Date(commit.date);
            const day = date.toLocaleDateString(undefined, { year: "numeric", month: "2-digit", day: "2-digit" });
            const time = date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
            const meta = this.details.createDiv({ cls: "pw-log-meta" });
            const hash = meta.createEl("button", { cls: "pw-log-revision", text: commit.hash.slice(0, 8), attr: { type: "button", title: "Copy full commit hash", "aria-label": "Copy full commit hash" } });
            hash.onclick = () => void this.el.ownerDocument.defaultView.navigator.clipboard.writeText(commit.hash).catch(error => new Notice(error.message));
            meta.createSpan({ text: ` ${commit.author} <` });
            const email = meta.createEl("a", { cls: "pw-log-email", text: commit.authorEmail,
                attr: { href: `mailto:${encodeURIComponent(commit.authorEmail)}` } });
            email.addEventListener("click", event => {
                event.preventDefault();
                void shell.openExternal(email.href).catch(error => {
                    if (!this.disposed) new Notice(error.message);
                });
            });
            meta.createSpan({ text: `> on ${day} at ${time}` });
            const branches = this.details.createDiv({ cls: "pw-log-meta pw-log-containing-branches", text: `In ${detail.branches.length} ${detail.branches.length === 1 ? "branch" : "branches"}: ` });
            for (const branch of detail.branches) {
                const button = branches.createEl("button", { text: branch, attr: { type: "button", title: `Show ${branch} in Log` } });
                button.onclick = () => this.selectRef(branch, branch);
            }
            if (!detail.branches.length) branches.appendText("None");
        } catch (error) { if (!request.signal.aborted && !this.disposed && revision === this.selectionRevision) this.changedFiles.clear(error.message); }
    }

    async openDiff(commit, file) {
        const revision = this.diffRevision = (this.diffRevision || 0) + 1;
        const root = this.controller.repository.root;
        try {
            const files = Array.isArray(file) ? file : [file];
            const path = files.length === 1 ? files[0].path : `${files.length} files`;
            const groups = new Map();
            for (const file of files) {
                const parent = file.parentHash || commit.parents[0];
                if (!groups.has(parent)) groups.set(parent, []);
                groups.get(parent).push(file);
            }
            const patches = await Promise.all([...groups].map(async ([parent, entries]) => {
                const paths = [...new Set(entries.flatMap(file => [file.original, file.path].filter(Boolean)))];
                const patch = parent ? await this.history.git.diffCommit(parent, commit.hash, paths)
                    : await this.history.git.diffCommitAgainstParent(commit.hash, paths);
                return groups.size > 1 ? `Changes against parent ${parent}\n${patch}` : patch;
            }));
            const text = patches.join("\n");
            if (this.disposed || this.controller.disposed || !this.el.isConnected || revision !== this.diffRevision || root !== this.controller.repository.root) return;
            const doc = this.el.ownerDocument;
            await this.controller.openDiffText(text || "No textual changes (the file may be binary).", `${path} @ ${commit.hash.slice(0, 8)}`, doc,
                { historical: true, revision: commit.hash });
        } catch (error) { if (!this.disposed) new Notice(error.message); }
    }

    navigate(event) {
        if (!this.commits?.length) return;
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
            event.preventDefault(); this.selectedHashes = new Set(this.commits.map(commit => commit.hash));
            void this.selectCommit(this.selected || this.commits[0], { preserve: true }); return;
        }
        if (event.key === "Enter" && this.selected && this.changedFiles.files.length) { event.preventDefault(); void this.openDiff(this.selected, this.changedFiles.files); return; }
        if (event.key === "F10" && event.shiftKey && this.selected) {
            event.preventDefault(); const menu = this.createMenu(); addHistoryCommitMenu(menu, this, this.selected);
            const rect = this.rows.getBoundingClientRect(); menu.showAtPosition({ x: rect.left + 20, y: rect.top + 20 }); return;
        }
        if (!["ArrowDown", "ArrowUp", "Home", "End", "PageDown", "PageUp"].includes(event.key)) return;
        event.preventDefault();
        const index = this.commits.findIndex(commit => commit.hash === this.selected?.hash);
        const height = this.graphLayout.height;
        const page = Math.max(1, Math.floor(this.rows.clientHeight / height));
        const requested = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: this.commits.length - 1, PageDown: index + page, PageUp: index - page }[event.key];
        const next = Math.max(0, Math.min(this.commits.length - 1, requested));
        const top = next * height;
        if (top < this.rows.scrollTop) this.rows.scrollTop = top;
        else if (top + height > this.rows.scrollTop + this.rows.clientHeight) this.rows.scrollTop = top + height - this.rows.clientHeight;
        this.renderVisibleRows();
        void this.selectCommit(this.commits[next], event);
    }

    updateActiveRow() {
        const row = [...this.rows.querySelectorAll(".pw-log-row")].find(item => item.dataset.hash === this.selected?.hash);
        if (row) this.rows.setAttribute("aria-activedescendant", row.id);
        else this.rows.removeAttribute("aria-activedescendant");
    }

    showBranches() {
        this.el.classList.remove("is-branches-hidden"); this.branchSearch.focus();
        this.savePreferences({ logBranchesHidden: false });
    }

    branchSettings(event) {
        const menu = this.createMenu();
        menu.addItem(item => item.setTitle("Group by Directory").setChecked(this.groupDirectories).onClick(() => {
            this.groupDirectories = !this.groupDirectories; this.savePreferences({ logGroupDirectories: this.groupDirectories }); this.renderBranches();
        }));
        menu.addItem(item => item.setTitle("Show Tags").setChecked(this.showTags).onClick(() => { this.showTags = !this.showTags; this.savePreferences({ logShowTags: this.showTags }); this.renderBranches(); }));
        menu.showAtMouseEvent(event);
    }

    settings(event) {
        const menu = this.createMenu();
        for (const [title, key, preference] of [["Author", "showAuthor", "logShowAuthor"], ["Date", "showDate", "logShowDate"]]) {
            menu.addItem(item => item.setTitle(`Show ${title} Column`).setChecked(this[key]).onClick(() => {
                this[key] = !this[key]; this.savePreferences({ [preference]: this[key] });
                this.el.classList.toggle(key === "showAuthor" ? "is-author-hidden" : "is-date-hidden", !this[key]);
            }));
        }
        menu.addItem(item => item.setTitle("Show Commit Details").setChecked(this.showDetails).onClick(() => {
            this.showDetails = !this.showDetails; this.details.hidden = this.detailsGrip.hidden = !this.showDetails;
            this.savePreferences({ logShowDetails: this.showDetails });
        }));
        menu.addItem(item => item.setTitle("Filter Settings…").onClick(() => this.filterSettings(event)));
        menu.showAtMouseEvent(event);
    }

    filterSettings(event) {
        const menu = this.createMenu();
        menu.addItem(item => item.setTitle("Show Tags").setChecked(!!this.showTags).onClick(() => { this.showTags = !this.showTags; this.savePreferences({ logShowTags: this.showTags }); this.renderBranches(); }));
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
    compareSelection() {
        const commits = this.commits.filter(commit => this.selectedHashes.has(commit.hash));
        if (commits.length === 2) this.controller.compare(commits[1].hash, commits[0].hash);
    }
    async batch(operation) {
        const selected = this.commits.filter(commit => this.selectedHashes.has(commit.hash));
        if (!selected.length || selected.some(commit => commit.parents.length > 1)) { new Notice("Select ordinary commits; merge commits require choosing a mainline parent."); return; }
        const chronological = topologicalCommits(selected).reverse();
        const hashes = (operation === "revert" ? [...chronological].reverse() : chronological).map(commit => commit.hash);
        const root = this.controller.repository.root, head = await this.controller.repository.head();
        if (!await confirm(this.controller, `${operation} selected commits`, `Apply ${operation} to ${hashes.length} commits in the displayed sequence? Resolve any conflicts from Commit.`, "Continue")) return;
        await this.action(controller => controller.act(async () => {
            if (root !== controller.repository.root || head !== await controller.repository.head()) throw new Error("The repository changed. Select commits again.");
            await controller.repository.assertNoOperation();
            await controller.repository.run([operation, ...hashes], { env: { GIT_EDITOR: "true" } });
        }));
    }
    dispose() {
        this.diffModal?.close();
        this.detailsRequest?.abort();
        this.disposed = true; this.myBranchesRequest?.abort(); ++this.revision; ++this.selectionRevision; clearTimeout(this.timer);
        if (this.rowFrame !== undefined) this.el.ownerDocument.defaultView.cancelAnimationFrame(this.rowFrame);
        this.resizeObserver?.disconnect(); this.stopHistory?.(); this.stopSnapshots?.();
        for (const splitter of this.splitters) splitter.dispose();
        for (const menu of this.menus) menu.hide(); this.menus.clear(); this.scope.dispose(); this.el.remove();
    }
}
