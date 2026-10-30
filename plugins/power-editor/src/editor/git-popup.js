import { Menu, Notice } from "obsidian";
import { iconName, setIcon } from "../../../utils/icons";
import { GitRepository } from "./git-repository";

const ACTIONS = [
    ["pull", "Update Project…", "arrow-down-left"],
    ["open-commit", "Commit…", "check"],
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
        this.expanded = new Set(["Recent"]);
        this.mode = "branches";
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
        this.expandButton = this.tool(header, "Expand popup", "expand", () => {
            const wide = this.el.classList.toggle("is-wide");
            this.expandButton.setAttribute("aria-label", wide ? "Restore popup size" : "Expand popup");
            this.position();
        });
        this.tool(header, "Git settings", "settings", () => {
            this.close(); this.app.setting.open(); this.app.setting.openTabById("patchwork-git");
        });
        this.content = this.el.createDiv({ cls: "pw-git-popup-content" });
        this.el.addEventListener("keydown", (event) => this.keydown(event));
        this.outside = (event) => {
            if (!this.el.contains(event.target) && !this.anchor.contains(event.target) && !this.branchMenu?.dom.contains(event.target)) this.close(false);
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
        const button = host.createEl("button", { cls: "clickable-icon", attr: { type: "button", "aria-label": label, title: label } });
        setIcon(button, icon);
        button.addEventListener("click", action);
        return button;
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
        this.content.empty();
        if (this.mode === "revisions") { this.renderRevisions(); this.position(); return; }
        for (const action of ACTIONS) this.action(...action);
        this.content.createDiv({ cls: "pw-git-separator" });
        this.action("create-branch", "New Branch…", "plus");
        if (this.matches("Checkout Tag or Revision…")) {
            const button = this.row("Checkout Tag or Revision…", "git-branch-flipped", () => {
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
        this.group("Recent", this.data.recent);
        this.group("Local", this.data.local);
        this.group("Remote", this.data.remote, true);
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
        for (const branch of filtered) this.branch(branch, remote);
    }

    branch(ref, remote) {
        const current = !remote && ref === this.data.current;
        const button = this.row(ref, current ? "tag" : "git-branch-flipped", () => this.branchActions(button, ref, remote));
        button.classList.add("pw-git-branch");
        button.classList.toggle("is-current", current);
        button.setAttribute("aria-haspopup", "menu");
        if (current) {
            button.setAttribute("aria-current", "true");
        }
        const tracking = !remote && this.data.upstreams.get(ref);
        if (tracking) button.createSpan({ cls: "pw-git-row-detail", text: tracking });
        setIcon(button.createSpan({ cls: "pw-git-branch-more" }), "chevron-right");
    }

    branchActions(button, ref, remote) {
        this.branchMenu?.hide();
        const menu = this.branchMenu = new Menu();
        menu.setParentElement(button);
        menu.addItem((item) => item.setTitle("Checkout").setIcon(iconName("git-branch-flipped"))
            .setDisabled(!remote && ref === this.data.current).onClick(() => { this.close(); this.repository.checkout(ref, remote); }));
        menu.addItem((item) => item.setTitle("Copy branch name").setIcon("copy").onClick(async () => {
            try { await this.doc.defaultView.navigator.clipboard.writeText(ref); }
            catch { new Notice("Could not copy branch name."); }
        }));
        menu.onHide(() => { if (this.branchMenu === menu) this.branchMenu = undefined; });
        const bounds = button.getBoundingClientRect();
        menu.showAtPosition({ x: bounds.right, y: bounds.top });
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
        this.doc.removeEventListener("pointerdown", this.outside, true);
        this.doc.defaultView.removeEventListener("resize", this.reposition);
        this.el.remove();
        this.anchor.setAttribute("aria-expanded", "false");
        if (focus && this.anchor.isConnected) this.anchor.focus();
        this.onClose();
    }
}
