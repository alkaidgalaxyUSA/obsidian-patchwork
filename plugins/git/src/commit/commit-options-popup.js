import { Component, Menu, Notice } from "obsidian";
import { scopeModule } from "../../../utils/module-scope";
import { scopeGitMenu } from "../utils/portals";
import { setIcon } from "../utils/icons";

/** Anchored commit options, backed by Git's real author/signoff/hook behavior. */
export class CommitOptionsPopup extends Component {
    constructor(view, onClose) {
        super();
        this.view = view;
        this.controller = view.controller;
        this.anchor = view.commitOptionsButton;
        this.doc = this.anchor.ownerDocument;
        this.root = this.controller.repository.root;
        this.onClose = onClose;
    }

    valid() {
        return !this.closed && !this.controller.disposed && !this.controller.busy && !this.controller.operation && this.anchor.isConnected
            && this.anchor.ownerDocument === this.doc
            && !this.doc.defaultView.closed && this.controller.repository.root === this.root;
    }

    open() { this.load(); }

    onload() {
        const controller = this.controller;
        if (controller.commitOptions?.root !== this.root) controller.commitOptions = { root: this.root, author: "", runHooks: true };
        this.options = controller.commitOptions;
        this.el = this.doc.createElement("div");
        this.el.className = "menu pw-git-commit-options-popup";
        this.el.setAttribute("role", "dialog");
        this.el.setAttribute("aria-label", "Commit Options");
        const scope = scopeModule(this.el, "git", { surface: "commit-options" });
        scope.refreshTokens(this.view.contentEl);
        this.register(() => scope.dispose());
        controller.dialogs.add(this);
        this.register(() => controller.dialogs.delete(this));
        this.register(() => this.el.remove());

        const git = this.group("Git");
        const row = git.createEl("label", { cls: "pw-git-commit-option" });
        row.createSpan({ text: "Author" });
        this.author = row.createEl("input", { type: "text", attr: { placeholder: "Default Git author", "aria-label": "Commit author", spellcheck: "false", autocomplete: "off" } });
        this.author.value = this.options.author;
        this.warning = git.createDiv({ cls: "pw-git-commit-author-warning", attr: { role: "status" } });
        this.registerDomEvent(this.author, "input", () => {
            if (!this.valid()) return;
            this.options.author = this.author.value.trim();
            this.updateAuthorWarning();
        });
        this.preference(git, "Sign-off commit", "signOffCommit", false,
            "Add a Signed-off-by trailer using the committer identity. This is not a GPG signature.");

        const checks = this.group("Commit Checks");
        this.hooks = this.checkbox(checks, "Run Git hooks", this.options.runHooks !== false, input => {
            this.options.runHooks = input.checked;
        });
        this.hooks.row.hidden = true;
        this.hooks.input.title = "When unchecked, Git skips pre-commit and commit-msg hooks (--no-verify). Other hooks still run.";
        this.preference(checks, "Check whitespace", "checkWhitespace", false,
            "Check the exact commit index for whitespace errors and newly added conflict markers before committing.");

        const scopeGroup = this.group("Commit Scope");
        const label = scopeGroup.createDiv({ cls: "pw-git-commit-option" });
        label.createSpan({ text: "Commit" });
        this.scopeButton = label.createEl("button", { cls: "pw-git-commit-scope-select", attr: {
            type: "button", "aria-label": "Commit scope", "aria-haspopup": "menu", "aria-expanded": "false",
        } });
        this.scopeLabel = this.scopeButton.createSpan({ text: controller.commitMode === "staged" ? "All staged changes" : "All changes in checked files" });
        setIcon(this.scopeButton.createSpan(), "chevron-down");
        this.registerDomEvent(this.scopeButton, "click", () => this.showScopeMenu());
        this.registerDomEvent(this.scopeButton, "keydown", event => {
            if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
            event.preventDefault(); this.showScopeMenu();
        });
        this.registerDomEvent(this.doc, "pointerdown", event => {
            if (!this.el.contains(event.target) && !this.anchor.contains(event.target) && !this.scopeMenu?.dom.contains(event.target)) this.close(false);
        }, true);
        this.registerDomEvent(this.el, "keydown", event => {
            if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); this.close(); }
        });
        this.registerDomEvent(this.doc.defaultView, "resize", () => this.position());
        this.registerDomEvent(this.doc.defaultView, "unload", () => this.close(false));
        this.doc.body.append(this.el);
        this.anchor.setAttribute("aria-expanded", "true");
        this.position();
        this.author.focus();
        void this.loadInfo();
    }

    group(title) {
        const group = this.el.createEl("fieldset");
        group.createEl("legend", { text: title });
        return group;
    }

    showScopeMenu() {
        if (!this.valid()) return;
        if (this.scopeMenu) { this.scopeMenu.hide(); return; }
        const menu = scopeGitMenu(new Menu(), this.el);
        this.scopeMenu = menu;
        menu.dom.classList.add("pw-git-commit-scope-menu");
        for (const [value, text] of [["staged", "All staged changes"], ["working", "All changes in checked files"]]) {
            menu.addItem(item => item.setTitle(text).setChecked(this.controller.commitMode === value).onClick(() => {
                if (!this.valid()) return;
                this.controller.commitMode = value;
                this.scopeLabel.textContent = text;
                this.view.selectedStage = undefined;
                this.controller.validationRequested = false;
                this.controller.saveDraft(); this.controller.render();
            }));
        }
        menu.onHide(() => {
            if (this.scopeMenu === menu) this.scopeMenu = undefined;
            this.scopeButton.setAttribute("aria-expanded", "false");
            if (this.valid()) this.scopeButton.focus();
        });
        this.scopeButton.setAttribute("aria-expanded", "true");
        const bounds = this.scopeButton.getBoundingClientRect();
        menu.showAtPosition({ x: bounds.left, y: bounds.bottom + 4 });
    }

    checkbox(group, title, checked, change) {
        const row = group.createEl("label", { cls: "pw-git-commit-option" });
        const input = row.createEl("input", { type: "checkbox" });
        input.checked = checked;
        row.createSpan({ text: title });
        this.registerDomEvent(input, "change", () => { if (this.valid()) change(input); });
        return { row, input };
    }

    preference(group, title, key, fallback, description) {
        const store = this.controller.plugin.settingsStore;
        const { input } = this.checkbox(group, title, store.preferences[key] ?? fallback, async input => {
            const previous = !input.checked;
            input.disabled = true;
            try { await store.savePreferences({ [key]: input.checked }); }
            catch (error) {
                store.preferences[key] = previous;
                input.checked = previous;
                new Notice(`Could not save commit options: ${error.message}`);
            } finally { if (this.valid()) input.disabled = false; }
        });
        input.title = description;
    }

    async loadInfo() {
        try {
            const info = await this.controller.repository.commitOptionsInfo();
            if (!this.valid()) return;
            this.identity = info.identity;
            this.author.placeholder = info.identity || "Name <email>";
            this.hooks.row.hidden = !info.hasHooks;
            if (!info.hasHooks) this.options.runHooks = true;
            this.updateAuthorWarning();
            this.position();
        } catch (error) {
            if (!this.valid()) return;
            this.warning.textContent = "Could not load repository options. Reopen this panel to retry.";
        }
    }

    updateAuthorWarning() {
        const author = this.options.author;
        const invalid = !!author && !/^[^<>\r\n\x00]+ <[^<>\s\x00]+>$/.test(author);
        this.author.setAttribute("aria-invalid", String(invalid));
        this.warning.textContent = invalid ? "Enter the author as Name <email>."
            : author && author !== this.identity ? "The commit author differs from the default Git author." : "";
    }

    position() {
        if (!this.valid()) { this.close(false); return; }
        const win = this.doc.defaultView;
        const anchor = this.anchor.getBoundingClientRect();
        const bounds = this.el.getBoundingClientRect();
        this.el.style.left = `${Math.max(8, Math.min(anchor.left, win.innerWidth - bounds.width - 8))}px`;
        this.el.style.top = `${Math.max(8, anchor.top >= bounds.height + 8 ? anchor.top - bounds.height - 4 : Math.min(anchor.bottom + 4, win.innerHeight - bounds.height - 8))}px`;
    }

    close(focus = true) {
        if (this.closed) return;
        this.closed = true;
        this.scopeMenu?.hide();
        this.unload();
        this.anchor.setAttribute("aria-expanded", "false");
        if (focus && this.anchor.isConnected) this.anchor.focus();
        this.onClose();
    }
}
