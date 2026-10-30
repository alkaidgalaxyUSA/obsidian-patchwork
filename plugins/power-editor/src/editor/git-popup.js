import { Menu, Notice } from "obsidian";
import { iconName, setIcon } from "../../../utils/icons";
import { GitRepository } from "./git-repository";

const ACTIONS = [
    ["pull", "Update Project…", "arrow-down-left"],
    ["open-commit", "Commit…", "git-commit"],
    ["push", "Push…", "arrow-up-right"],
];

/** IDEA-style action groups and searchable, expandable repository branches. */
export class GitPopup {
    constructor(app, anchor, onClose) {
        this.app = app;
        this.anchor = anchor;
        this.doc = anchor.ownerDocument;
        this.onClose = onClose;
        this.repository = new GitRepository(app);
        this.expanded = new Set(["Recent", "Remote"]);
        this.collapsedRemotes = new Set();
        this.mode = "branches";
        this.preferencesPlugin = app.plugins.plugins["patchwork-power-editor"];
        this.options = { showActions: true, groupByPrefix: false, showRecent: true, showTags: false,
            ...this.preferencesPlugin?.settings.gitPopupOptions };
        this.collapsedPrefixes = new Set();
    }

    open() {
        this.el = this.doc.createElement("div");
        this.el.className = "menu pw-git-popup";
        this.el.setAttribute("role", "dialog");
        this.el.setAttribute("aria-label", "Git branches and actions");
        const header = this.el.createDiv({ cls: "pw-git-popup-header" });
        const search = header.createDiv({ cls: "pw-git-search-box" });
        setIcon(search.createSpan(), "search");
        this.input = search.createEl("input", { type: "search", attr: { placeholder: "Search for branches and actions", "aria-label": "Search for branches and actions" } });
        this.input.addEventListener("input", () => this.render());
        this.fetchButton = this.tool(header, "Fetch", "refresh-cw", async () => {
            if (this.fetching) return;
            this.fetching = true;
            this.fetchButton.disabled = true;
            this.fetchButton.setAttribute("aria-busy", "true");
            try { await this.repository.fetch(); await this.load(); }
            finally {
                this.fetching = false;
                this.fetchButton.disabled = !this.repository.plugin?.gitReady;
                this.fetchButton.removeAttribute("aria-busy");
            }
        });
        this.settingsButton = this.tool(header, "Settings", "settings", () => this.showSettings());
        this.content = this.el.createDiv({ cls: "pw-git-popup-content" });
        this.content.addEventListener("scroll", () => this.branchMenu?.hide());
        this.content.addEventListener("pointerover", event => {
            const row = event.target.closest(".pw-git-row");
            if (row && row.dataset.ref !== this.branchMenuRef) this.branchMenu?.hide();
        });
        this.el.addEventListener("keydown", (event) => this.keydown(event));
        this.outside = (event) => {
            if (!this.el.contains(event.target) && !this.anchor.contains(event.target) && !this.branchMenu?.dom.contains(event.target) && !this.settingsMenu?.dom.contains(event.target)) this.close(false);
        };
        this.reposition = () => this.position();
        this.doc.addEventListener("pointerdown", this.outside, true);
        this.doc.defaultView.addEventListener("resize", this.reposition);
        this.doc.body.append(this.el);
        this.anchor.setAttribute("aria-expanded", "true");
        this.render();
        this.input.focus();
        void this.load();
    }

    async load() {
        const revision = this.loadRevision = (this.loadRevision ?? 0) + 1;
        try {
            const data = await this.repository.snapshot();
            if (this.closed || revision !== this.loadRevision) return;
            this.data = data; this.error = undefined;
        } catch (error) {
            if (this.closed || revision !== this.loadRevision) return;
            this.data = undefined; this.error = error.message;
        }
        if (!this.closed) this.render();
    }

    tool(host, label, icon, action) {
        const button = host.createEl("button", { cls: "clickable-icon", attr: { type: "button", "aria-label": label } });
        setIcon(button, icon);
        button.addEventListener("click", action);
        return button;
    }

    showSettings() {
        if (this.settingsMenu) { this.settingsMenu.hide(); return; }
        this.branchMenu?.hide();
        const menu = this.settingsMenu = new Menu();
        menu.dom.classList.add("pw-git-submenu");
        menu.setParentElement(this.settingsButton);
        const option = (key, title) => menu.addItem(item => item.setTitle(title).setChecked(this.options[key]).onClick(() => {
            this.options[key] = !this.options[key];
            if (key === "showTags" && this.options[key]) this.expanded.add("Tags");
            this.render();
            if (!this.preferencesPlugin) return;
            this.preferencesPlugin.settings.gitPopupOptions = { ...this.options };
            void this.preferencesPlugin.persistSettings().catch(() => new Notice("Could not save Git popup preferences."));
        }));
        option("showActions", "Show Action in Search Result");
        menu.addSeparator();
        option("groupByPrefix", "Group by Prefix");
        option("showRecent", "Show Recent Branches");
        option("showTags", "Show Tags");
        menu.addItem(item => item.setTitle("Restore Popup Size").setDisabled(true));
        this.settingsButton.setAttribute("aria-expanded", "true");
        menu.onHide(() => {
            if (this.settingsMenu === menu) this.settingsMenu = undefined;
            this.settingsButton.setAttribute("aria-expanded", "false");
        });
        const bounds = this.settingsButton.getBoundingClientRect();
        menu.showAtPosition({ x: bounds.left, y: bounds.bottom + 4 });
    }

    row(label, icon, action) {
        const button = this.content.createEl("button", { cls: "pw-git-row", attr: { type: "button" } });
        const glyph = button.createSpan({ cls: "pw-git-row-icon" });
        if (icon) setIcon(glyph, icon);
        button.createSpan({ cls: "pw-git-row-label", text: label });
        button.addEventListener("click", action);
        return button;
    }

    matches(text) {
        return this.input.value.toLowerCase().trim().split(/\s+/).filter(Boolean).every((word) => text.toLowerCase().includes(word));
    }

    action(id, label, icon) {
        if (!this.matches(label)) return;
        const button = this.row(label, icon, () => { this.close(); this.repository.command(id); });
        button.disabled = !this.app.commands.commands[`patchwork-git:${id}`] || !this.repository.plugin?.gitReady;
        const keys = this.app.hotkeyManager.getHotkeys(`patchwork-git:${id}`)?.[0];
        if (keys) button.createSpan({ cls: "pw-git-row-detail", text: [...keys.modifiers.map((key) => key === "Mod" ? "Ctrl" : key), keys.key].join("+") });
    }

    render() {
        this.branchMenu?.hide();
        this.fetchButton.disabled = !!this.fetching || !this.repository.plugin?.gitReady;
        this.content.empty();
        if (this.mode === "revisions") { this.renderRevisions(); this.position(); return; }
        const showActions = !this.input.value.trim() || this.options.showActions;
        if (showActions) {
            for (const action of ACTIONS) this.action(...action);
            this.content.createDiv({ cls: "pw-git-separator" });
            this.action("create-branch", "New Branch…", "plus");
        }
        if (showActions && this.matches("Checkout Tag or Revision…")) {
            const button = this.row("Checkout Tag or Revision…", "", () => {
                this.mode = "revisions"; this.input.value = "";
                this.input.placeholder = "Tag or revision to check out";
                this.input.setAttribute("aria-label", this.input.placeholder);
                this.render(); this.input.focus();
            });
            button.disabled = !this.repository.plugin?.gitReady;
        }
        this.content.createDiv({ cls: "pw-git-separator" });
        if (!this.data) {
            this.content.createDiv({ cls: "pw-git-status", text: this.error ?? "Loading branches…", attr: { role: "status" } });
            if (this.repository.plugin?.repositoryMissing) this.row("Initialize Repository…", "plus", () => { this.close(); this.repository.command("init-repo"); });
            this.position(); return;
        }
        if (this.options.showRecent) this.group("Recent", this.data.recent);
        this.group("Local", this.data.local);
        this.group("Remote", this.data.remote, true);
        if (this.options.showTags) this.group("Tags", this.data.tags);
        if (this.input.value.trim() && !this.content.querySelector(".pw-git-row")) this.content.createDiv({ cls: "pw-git-status", text: "No matching branches or actions", attr: { role: "status" } });
        this.position();
    }

    group(name, branches, remote = false) {
        const filtered = branches.filter((branch) => this.matches(branch));
        const searching = !!this.input.value.trim();
        if (searching && !filtered.length) return;
        const expanded = searching || this.expanded.has(name);
        const heading = this.row(name, expanded ? "chevron-down" : "chevron-right", () => {
            if (this.expanded.has(name)) this.expanded.delete(name); else this.expanded.add(name);
            this.render();
            [...this.content.querySelectorAll(".pw-git-group")].find((el) => el.dataset.group === name)?.focus();
        });
        heading.classList.add("pw-git-group");
        heading.dataset.group = name;
        heading.setAttribute("aria-expanded", String(expanded));
        if (!expanded) return;
        if (!filtered.length) this.content.createDiv({ cls: "pw-git-status", text: remote && this.data.remoteError ? "Could not load remote branches" : "No branches" });
        if (remote) { this.remoteGroups(filtered, searching); return; }
        this.branchList(filtered, remote, name);
    }

    branchList(refs, remote, group, base = "", prefix = "", depth = 0) {
        const folders = new Map();
        const searching = !!this.input.value.trim();
        for (const ref of refs) {
            const label = ref.slice(base.length + prefix.length);
            const slash = this.options.groupByPrefix ? label.indexOf("/") : -1;
            if (slash >= 0) {
                const name = label.slice(0, slash);
                if (!folders.has(name)) folders.set(name, []);
                folders.get(name).push(ref);
                continue;
            }
            const row = group === "Tags"
                ? this.row(label, "tag", () => { this.close(); this.repository.checkout(ref); })
                : this.branch(ref, remote, label);
            if (group === "Tags" || depth) row.style.paddingLeft = `${(remote ? 72 : 48) + depth * 20}px`;
        }
        for (const [name, children] of folders) {
            const next = `${prefix}${name}/`;
            const key = `${group}:${base}${next}`;
            const expanded = searching || !this.collapsedPrefixes.has(key);
            const folder = this.row(name, expanded ? "chevron-down" : "chevron-right", () => {
                if (this.collapsedPrefixes.has(key)) this.collapsedPrefixes.delete(key);
                else this.collapsedPrefixes.add(key);
                this.render();
            });
            folder.classList.add("pw-git-prefix-folder");
            folder.style.paddingLeft = `${(remote ? 72 : 48) + depth * 20}px`;
            folder.setAttribute("aria-expanded", String(expanded));
            if (expanded) this.branchList(children, remote, group, base, next, depth + 1);
        }
    }

    remoteGroups(branches, searching) {
        const names = this.data.remotes ?? [...new Set(branches.map(ref => ref.split("/")[0]))];
        for (const name of names) {
            const refs = branches.filter(ref => ref.startsWith(`${name}/`));
            if (searching && !refs.length) continue;
            const expanded = searching || !this.collapsedRemotes.has(name);
            const folder = this.row(name, expanded ? "chevron-down" : "chevron-right", () => {
                if (this.collapsedRemotes.has(name)) this.collapsedRemotes.delete(name);
                else this.collapsedRemotes.add(name);
                this.render();
                [...this.content.querySelectorAll(".pw-git-remote-folder")].find(row => row.dataset.remote === name)?.focus();
            });
            folder.classList.add("pw-git-remote-folder");
            folder.dataset.remote = name;
            folder.setAttribute("aria-expanded", String(expanded));
            const icon = this.doc.createElement("span");
            icon.className = "pw-git-row-icon";
            setIcon(icon, "folder");
            folder.insertBefore(icon, folder.querySelector(".pw-git-row-label"));
            if (!expanded) continue;
            this.branchList(refs, true, "Remote", `${name}/`);
        }
    }

    branch(ref, remote, label = ref) {
        const current = !remote && ref === this.data.current;
        const button = this.row(label, current ? "git-current-branch" : "git-branch-flipped", () => this.branchActions(button, ref, remote));
        button.classList.add("pw-git-branch");
        button.classList.add(remote ? "pw-git-remote-branch" : "pw-git-local-branch");
        button.dataset.ref = ref;
        button.classList.toggle("is-current", current);
        button.setAttribute("aria-haspopup", "menu");
        if (current) {
            button.setAttribute("aria-current", "true");
        }
        const tracking = !remote && this.data.upstreams.get(ref);
        if (tracking) button.createSpan({ cls: "pw-git-row-detail", text: tracking });
        setIcon(button.createSpan({ cls: "pw-git-branch-more" }), "chevron-right");
        button.addEventListener("pointerenter", event => {
            if (remote && event.pointerType !== "touch") this.branchActions(button, ref, true);
        });
        button.addEventListener("keydown", event => {
            if (event.key !== "ArrowRight") return;
            event.preventDefault(); event.stopPropagation();
            this.branchActions(button, ref, remote);
        });
        return button;
    }

    branchActions(button, ref, remote) {
        if (this.branchMenu?.dom.isConnected && this.branchMenuRef === ref) return;
        this.branchMenu?.hide();
        const menu = this.branchMenu = new Menu();
        menu.dom.classList.add("pw-git-submenu");
        this.branchMenuRef = ref;
        menu.setParentElement(button);
        if (remote) this.remoteBranchActions(menu, ref);
        else {
            menu.addItem((item) => item.setTitle("Checkout").setIcon(iconName("git-branch-flipped"))
                .setDisabled(ref === this.data.current).onClick(() => { this.close(); this.repository.checkout(ref); }));
            menu.addItem((item) => item.setTitle("Copy branch name").setIcon("copy").onClick(async () => {
                try { await this.doc.defaultView.navigator.clipboard.writeText(ref); }
                catch { new Notice("Could not copy branch name."); }
            }));
        }
        button.setAttribute("aria-expanded", "true");
        menu.onHide(() => {
            button.setAttribute("aria-expanded", "false");
            if (this.branchMenu === menu) { this.branchMenu = undefined; this.branchMenuRef = undefined; }
        });
        const bounds = button.getBoundingClientRect();
        menu.showAtPosition({ x: bounds.right, y: bounds.top });
    }

    remoteBranchActions(menu, ref) {
        const current = this.data.current;
        const local = this.data.local.includes(current);
        const busy = !!this.repository.plugin?.controller.busy;
        const actions = [
            ["checkout", "Checkout"],
            ["new-branch", `New Branch from '${ref}'`],
            ["checkout-rebase", `Checkout and Rebase onto '${current}'`, true],
            null,
            ["compare", `Compare with '${current}'`, true],
            ["working-diff", "Show Diff with Working Tree"],
            null,
            ["rebase", `Rebase '${current}' onto '${ref}'`, true],
            ["merge", `Merge '${ref}' into '${current}'`, true],
            null,
            ["worktree", `New Worktree from '${ref}'`],
            null,
            ["pull-rebase", `Pull into '${current}' Using Rebase`, true],
            ["pull-merge", `Pull into '${current}' Using Merge`, true],
        ];
        for (const action of actions) {
            if (!action) { menu.addSeparator(); continue; }
            const [id, title, needsLocal] = action;
            menu.addItem(item => item.setTitle(title).setDisabled(busy || needsLocal && !local)
                .onClick(() => { this.close(); void this.repository.remoteAction(id, ref, current); }));
        }
        menu.addSeparator();
        menu.addItem(item => {
            item.setTitle("Delete").setDisabled(true);
            item.dom.setAttribute("aria-label", "Remote branch deletion is not enabled.");
        });
    }

    renderRevisions() {
        this.row("Back to branches and actions", "arrow-left", () => {
            this.mode = "branches"; this.input.value = "";
            this.input.placeholder = "Search for branches and actions";
            this.input.setAttribute("aria-label", this.input.placeholder);
            this.render(); this.input.focus();
        });
        const query = this.input.value.trim();
        if (query) this.row(`Checkout ${query}`, "git-branch-flipped", () => { this.repository.checkout(query); this.close(); });
        this.content.createDiv({ cls: "pw-git-separator" });
        this.content.createDiv({ cls: "pw-git-status", text: this.data?.tagsError ? "Could not load tags; enter a revision above" : "Tags" });
        if (this.data && !this.data.tagsError && !this.data.tags.length) this.content.createDiv({ cls: "pw-git-status", text: "No tags. Enter a revision above." });
        for (const tag of this.data?.tags.filter((value) => this.matches(value)) ?? []) {
            this.row(tag, "tag", () => { this.close(); this.repository.checkout(tag); });
        }
    }

    keydown(event) {
        if (event.isComposing) return;
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); this.close(); return; }
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        if ((event.key === "Home" || event.key === "End") && event.target === this.input) return;
        event.preventDefault(); event.stopPropagation();
        const buttons = [...this.content.querySelectorAll("button:not(:disabled)")];
        if (!buttons.length) return;
        const index = buttons.indexOf(this.doc.activeElement);
        const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : event.key === "ArrowDown" ? (index + 1) % buttons.length : index < 0 ? buttons.length - 1 : (index - 1 + buttons.length) % buttons.length;
        buttons[next]?.focus();
    }

    position() {
        if (!this.el?.isConnected) return;
        const win = this.doc.defaultView;
        const anchor = this.anchor.getBoundingClientRect();
        const bounds = this.el.getBoundingClientRect();
        this.el.style.left = `${Math.max(8, Math.min(anchor.left, win.innerWidth - bounds.width - 8))}px`;
        this.el.style.top = `${Math.max(8, Math.min(anchor.bottom + 5, win.innerHeight - bounds.height - 8))}px`;
    }

    close(focus = true) {
        if (this.closed) return;
        this.closed = true;
        this.branchMenu?.hide();
        this.settingsMenu?.hide();
        this.doc.removeEventListener("pointerdown", this.outside, true);
        this.doc.defaultView.removeEventListener("resize", this.reposition);
        this.el.remove();
        this.anchor.setAttribute("aria-expanded", "false");
        if (focus && this.anchor.isConnected) this.anchor.focus();
        this.onClose();
    }
}
