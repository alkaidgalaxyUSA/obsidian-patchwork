import { Notice, normalizePath } from "obsidian";
import { isAbsolute, join, relative, resolve } from "node:path";
import { iconName } from "../../utils/icons";
import { PanelFocus } from "../../utils/panel-focus";
import { Repository } from "./repository";
import { COMMIT_VIEW, CommitView } from "./commit-view";
import { addGitMenu } from "./context-menu";
import { choose, confirm, prompt, showOutput } from "./dialogs";
import { GitSettings } from "./settings";
import { ExplorerStatus } from "./explorer-status";
import { Changelists } from "./changelists";
import { DIFF_VIEW, DiffView } from "./diff-view";
import { BranchActions } from "./branch-actions";

export class GitController {
    constructor(plugin, vaultPath, data) {
        this.plugin = plugin;
        this.app = plugin.app;
        this.repository = new Repository(vaultPath);
        this.branchActions = new BranchActions(this);
        this.explorerStatus = new ExplorerStatus(this.app, this.repository);
        this.views = new Set();
        this.entries = [];
        this.selected = new Set();
        this.known = new Set();
        this.collapsed = new Set();
        this.changelists = new Changelists(data?.changelists);
        this.draft = { message: typeof data?.message === "string" ? data.message : "", amend: !!data?.amend };
        this.busy = false;
        this.ready = false;
        this.lastOpenedFile = this.app.workspace.getActiveFile() ?? this.app.workspace.getMostRecentLeaf()?.view.file;
    }

    install() {
        const plugin = this.plugin;
        plugin.registerView(COMMIT_VIEW, leaf => new CommitView(leaf, this));
        plugin.registerView(DIFF_VIEW, leaf => new DiffView(leaf));
        this.ribbon = plugin.addRibbonIcon(iconName("git-commit"), "Commit", () => void this.open(true));
        this.ribbon.classList.add("pw-git-ribbon-action");
        this.ribbon.setAttribute("data-tooltip-position", "right");
        this.ribbon.setAttribute("role", "button");
        this.ribbon.tabIndex = 0;
        this.panelFocus = new PanelFocus(plugin, () => [
            { id: COMMIT_VIEW, button: this.ribbon, leaves: this.app.workspace.getLeavesOfType(COMMIT_VIEW) },
        ]);
        plugin.registerDomEvent(this.ribbon, "keydown", event => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault(); this.ribbon.click();
        });
        const commands = [
            ["open-commit", "Commit…", () => this.open()],
            ["refresh", "Refresh changes", () => this.refresh()],
            ["fetch", "Fetch", () => this.network("fetch")],
            ["pull", "Update Project…", () => this.network("pull")],
            ["push", "Push…", () => this.network("push")],
            ["create-branch", "New Branch…", () => this.newBranch()],
            ["init-repo", "Initialize Repository…", () => this.initialize()],
        ];
        for (const [id, name, callback] of commands) plugin.addCommand({ id, name, callback: () => { void callback(); } });
        plugin.registerEvent(this.app.workspace.on("file-menu", (menu, file) => this.fileMenu(menu, [file])));
        plugin.registerEvent(this.app.workspace.on("files-menu", (menu, files) => this.fileMenu(menu, files)));
        plugin.registerEvent(this.app.workspace.on("file-open", file => { if (file) this.lastOpenedFile = file; }));
        for (const event of ["layout-change", "active-leaf-change"]) {
            plugin.registerEvent(this.app.workspace.on(event, () => this.scheduleRibbon()));
        }
        const panelObserver = new this.app.workspace.containerEl.ownerDocument.defaultView.MutationObserver(records => {
            if (records.some(record => record.target.matches(".workspace-leaf, .workspace-tab-header"))) this.scheduleRibbon();
        });
        panelObserver.observe(this.app.workspace.leftSplit.containerEl, { subtree: true, attributes: true, attributeFilter: ["class", "style"] });
        plugin.register(() => panelObserver.disconnect());
        for (const event of ["create", "delete", "rename", "modify"]) {
            plugin.registerEvent(this.app.vault.on(event, () => this.scheduleRefresh()));
        }
        plugin.registerDomEvent(window, "focus", () => void this.refresh());
        plugin.registerInterval(window.setInterval(() => { this.syncRibbon(); void this.refresh(); }, 5000));
        plugin.addSettingTab(new GitSettings(this.app, plugin, this));
        this.app.workspace.onLayoutReady(() => { if (!this.disposed) { this.syncRibbon(); void this.refresh(); } });
    }

    fileMenu(menu, files) {
        if (!files.length) return;
        try { addGitMenu(menu, this, files.map(file => this.repository.path(file.path))); }
        catch { /* Files outside the discovered repository do not have Git actions. */ }
    }

    scheduleRibbon() {
        if (this.disposed || this.ribbonFrame !== undefined) return;
        this.ribbonFrame = this.app.workspace.containerEl.ownerDocument.defaultView.requestAnimationFrame(() => {
            this.ribbonFrame = undefined;
            this.syncRibbon();
        });
    }

    syncRibbon() {
        if (this.disposed) return;
        this.explorerStatus.sync();
        const ribbon = this.app.workspace.leftRibbon;
        const project = ribbon.containerEl.querySelector(".pw-left-sidebar-toggle");
        if (project && project.nextElementSibling !== this.ribbon) project.after(this.ribbon);
        else if (!project && this.ribbon.parentElement !== ribbon.ribbonItemsEl) ribbon.ribbonItemsEl.append(this.ribbon);
        const visible = this.app.workspace.getLeavesOfType(COMMIT_VIEW).some(leaf => this.visible(leaf));
        this.ribbon.setAttribute("aria-pressed", String(visible));
        this.ribbon.setAttribute("aria-expanded", String(visible));
        this.panelFocus.sync();
    }

    visible(leaf) {
        const dock = this.app.workspace.leftSplit;
        if (!leaf.tabHeaderEl?.classList.contains("is-active")) return false;
        const bounds = leaf.view.containerEl.getBoundingClientRect();
        return !dock.collapsed && bounds.width > 0 && bounds.height > 0;
    }

    async open(toggle = false) {
        if (this.opening || this.disposed) return;
        this.opening = true;
        try {
            let leaf = this.app.workspace.getLeavesOfType(COMMIT_VIEW)[0];
            if (leaf && toggle && this.visible(leaf)) { this.app.workspace.leftSplit.collapse(); return; }
            if (!leaf) {
                leaf = this.app.workspace.getLeftLeaf(false);
                if (!leaf) throw new Error("The left sidebar is unavailable.");
                await leaf.setViewState({ type: COMMIT_VIEW, active: true });
            }
            await this.app.workspace.revealLeaf(leaf);
        } catch (error) { new Notice(error.message); }
        finally { this.opening = false; this.syncRibbon(); }
    }

    async openSelection(paths) {
        await this.refresh();
        this.selected = new Set(this.entries.filter(entry => paths.some(path => path === "." || entry.path === path || entry.path.startsWith(`${path}/`))).map(entry => entry.path));
        await this.open(); this.render();
        for (const view of this.views) view.message.focus();
    }

    async newChangelist() {
        const name = await prompt(this.app, "New Changelist", "Changelist name");
        if (!name || this.disposed) return;
        try {
            this.changelists.create(name);
            this.saveDraft(); this.render();
        } catch (error) { new Notice(error.message); }
    }

    async editChangelist(id) {
        const list = this.changelists.lists.find(list => list.id === id);
        if (!list) return;
        const name = await prompt(this.app, "Edit Changelist", "Changelist name", list.name);
        if (!name || this.disposed) return;
        try {
            this.changelists.rename(id, name);
            this.saveDraft(); this.render();
        } catch (error) { new Notice(error.message); }
    }

    async moveToChangelist(paths) {
        if (!paths.length) return;
        const list = await choose(this.app, "Move to Another Changelist", this.changelists.lists);
        if (!list || this.disposed) return;
        try {
            this.changelists.move(paths, list.id);
            this.collapsed.delete(list.id);
            this.saveDraft(); this.render();
        } catch (error) { new Notice(error.message); }
    }

    sourceFile(path) {
        if (!path) return undefined;
        const vaultPath = relative(this.repository.vaultPath, resolve(this.repository.root, path)).replaceAll("\\", "/");
        if (isAbsolute(vaultPath) || vaultPath === ".." || vaultPath.startsWith("../")) return undefined;
        return this.app.vault.getFileByPath(vaultPath) ?? undefined;
    }

    async jumpToSource(paths) {
        const file = this.sourceFile(paths[0]);
        if (!file) { new Notice("The source file is unavailable in this vault."); return; }
        try { await this.app.workspace.getLeaf(false).openFile(file); }
        catch (error) { new Notice(error.message); }
    }

    async deleteFiles(paths) {
        if (!paths.length || this.busy) return;
        const files = paths.map(path => this.sourceFile(path));
        if (files.some(file => !file)) { new Notice("Only existing files inside this vault can be deleted here."); return; }
        if (!await confirm(this.app, "Delete files", `Move ${files.length} selected file(s) to trash? Git will detect tracked files as deleted.`, "Delete")) return;
        await this.act(async () => {
            for (const file of files) await this.app.fileManager.trashFile(file);
        });
    }

    ignoreFiles(paths, target) {
        if (!paths.length) return;
        return this.act(async () => {
            const count = await this.repository.ignore(paths, target);
            new Notice(count ? `Added ${count} ignore rule(s) to ${target}.` : "The selected files are already ignored or no longer unversioned.");
        });
    }

    async exportPatch(paths) {
        const destination = await prompt(this.app, "Create Patch from Local Changes", "Patch path relative to the vault (existing files are not overwritten)", "changes.patch");
        if (!destination || this.disposed) return;
        await this.act(async () => {
            if (isAbsolute(destination) || destination.replaceAll("\\", "/").split("/").includes("..") || !destination.endsWith(".patch")) {
                throw new Error("Enter a vault-relative path ending in .patch without parent directory segments.");
            }
            const patch = await this.repository.patch(paths);
            if (!patch.length) throw new Error("No changes to export.");
            await this.app.vault.createBinary(normalizePath(destination), patch.buffer.slice(patch.byteOffset, patch.byteOffset + patch.byteLength));
            new Notice(`Patch saved: ${destination}`);
        });
    }

    copyPatch(paths) {
        return this.act(async () => {
            const patch = await this.repository.patch(paths);
            if (!patch.length) throw new Error("No changes to copy.");
            const text = patch.toString("utf8");
            if (!Buffer.from(text, "utf8").equals(patch)) throw new Error("This patch contains non-UTF-8 text. Export it to a patch file to preserve its bytes.");
            await this.app.workspace.containerEl.ownerDocument.defaultView.navigator.clipboard.writeText(text);
            new Notice("Patch copied to clipboard.");
        });
    }

    scheduleRefresh() {
        clearTimeout(this.refreshTimer);
        this.refreshTimer = setTimeout(() => void this.refresh(), 500);
    }

    refresh(force = false) {
        if (this.disposed || (this.busy && !force)) return Promise.resolve();
        if (this.refreshing) return this.refreshing;
        this.refreshing = this.readStatus().finally(() => { this.refreshing = undefined; });
        return this.refreshing;
    }

    async readStatus() {
        try {
            if (!this.ready) await this.repository.discover();
            const [entries, branch, ignored] = await Promise.all([this.repository.status(), this.repository.branch(), this.repository.ignored()]);
            if (this.disposed) return;
            const changed = JSON.stringify(entries) !== JSON.stringify(this.entries) || this.error || !this.ready;
            for (const entry of entries) if (!this.known.has(entry.path) && !entry.untracked) this.selected.add(entry.path);
            const paths = new Set(entries.map(entry => entry.path));
            for (const path of this.selected) if (!paths.has(path)) this.selected.delete(path);
            this.known = paths;
            this.entries = entries; this.error = ""; this.ready = true;
            this.explorerStatus.update(entries, ignored);
            if (this.branch !== branch || changed) {
                this.branch = branch;
                this.app.workspace.trigger("patchwork-git:refreshed");
            }
            if (changed) this.render();
        } catch (error) {
            if (this.disposed) return;
            this.error = error.message; this.ready = false; this.render();
            this.explorerStatus.update([]);
            this.app.workspace.trigger("patchwork-git:refreshed");
        }
    }

    render() { for (const view of this.views) view.render(); }

    async act(action) {
        if (this.busy || this.disposed) return;
        this.busy = true; this.render();
        try {
            await this.refreshing;
            return await this.repository.mutate(action);
        } catch (error) { new Notice(`Git: ${error.message}`, 10000); }
        finally {
            await this.refresh(true);
            this.busy = false;
            if (!this.disposed) this.render();
        }
    }

    async commit(push) {
        if (this.busy) return;
        this.validationRequested = true;
        if (this.commitValidation()) { this.render(); return; }
        if (this.draft.amend && !await confirm(this.app, "Amend commit", "Replace the latest commit with the checked working-tree changes and this message? If it was pushed, a normal push may be rejected; this plugin never force-pushes.", "Amend")) return;
        await this.act(async () => {
            const result = await this.repository.commit(new Set(this.selected), this.draft.message, this.draft.amend);
            this.draft = { message: "", amend: false };
            this.validationRequested = false;
            for (const view of this.views) { view.message.value = ""; view.amend.checked = false; }
            this.saveDraft();
            if (result.warning) { new Notice(result.warning, 15000); return; }
            new Notice("Commit created.");
            if (!push || this.disposed) return;
            try { await this.repository.run(["push"]); new Notice("Push completed."); }
            catch (error) { new Notice(`Commit created; push failed. Use Push to retry without committing again.\n${error.message}`, 15000); }
        });
    }

    commitValidation() {
        const hasFiles = this.entries.some(entry => this.selected.has(entry.path));
        const hasMessage = !!this.draft.message.trim();
        if (!hasFiles && !hasMessage) return "Select files to commit and specify commit message";
        if (!hasFiles) return "Select files to commit";
        if (!hasMessage) return "specify commit message";
        return "";
    }

    network(action) {
        return this.act(async () => {
            // Respect configured remotes/upstreams; do not force, merge, or rebase silently.
            const args = action === "pull" ? ["pull", "--ff-only"] : action === "fetch" ? ["fetch", "--all"] : ["push"];
            const output = await this.repository.run(args);
            new Notice(output.trim() || `${action[0].toUpperCase()}${action.slice(1)} completed.`);
        });
    }

    async newBranch() {
        const name = await prompt(this.app, "New Branch", "Branch name");
        if (!name) return;
        await this.act(async () => {
            await this.repository.run(["check-ref-format", "--branch", name]);
            await this.repository.run(["switch", "-c", name]);
        });
    }

    async initialize() {
        if (!await confirm(this.app, "Initialize Repository", `Create a Git repository in ${this.repository.vaultPath}?`, "Initialize")) return;
        await this.act(() => this.repository.run(["init"], { cwd: this.repository.vaultPath }));
    }

    checkout(ref, remote) { return this.act(() => this.repository.checkout(ref, remote)); }

    async rollback(paths) {
        if (!paths.length || this.busy) return;
        if (!await confirm(this.app, "Rollback changes", `Discard tracked changes in ${paths.join(", ")}? Staged changes will also be discarded. Unversioned files will be kept.`, "Rollback")) return;
        await this.act(async () => {
            const entries = await this.repository.status();
            const matches = entries.filter(entry => !entry.untracked && paths.some(path => path === "." || entry.path === path || entry.path.startsWith(`${path}/`)));
            if (matches.some(entry => entry.code.includes("A") || entry.original || entry.conflict)) {
                throw new Error("Unstage added or renamed files and resolve conflicts before rollback. No files were changed.");
            }
            const files = matches.map(entry => entry.path);
            if (files.length) await this.repository.run(["restore", "--source=HEAD", "--staged", "--worktree", "--", ...files]);
        });
    }

    async shelve(paths, askTitle = false) {
        if (!paths.length) return;
        const message = askTitle ? await prompt(this.app, "Shelve Changes", "Shelf name", this.draft.message.trim().split(/\r?\n/)[0] || "Local changes") : this.draft.message;
        if (askTitle && !message) return;
        return this.act(async () => {
            const shelf = await this.repository.shelves.create(paths, message);
            new Notice(`Shelved ${shelf.paths.length} files. Restore them from View Options → Shelved Changes.`);
        });
    }

    async restoreShelf(shelf) {
        if (!await confirm(this.app, "Restore shelved changes", `Restore ${shelf.title} (${shelf.paths.length} files)? Existing changes to those files must be committed or shelved first.`, "Restore")) return;
        await this.act(async () => {
            const result = await this.repository.shelves.restore(shelf.id);
            new Notice(result.warning || "Shelved changes restored.", result.warning ? 15000 : 5000);
        });
    }

    showDiff(paths, newTab = false) {
        if (!paths.length) return;
        return this.act(async () => {
            const head = await this.repository.head();
            const args = ["diff", "--no-ext-diff", "--no-textconv", "--no-color", ...(head ? ["HEAD"] : ["--cached"]), "--", ...paths];
            const output = [await this.repository.run(args)];
            if (!head) output.push(await this.repository.run(["diff", "--no-ext-diff", "--no-textconv", "--no-color", "--", ...paths]));
            const untracked = (await this.repository.status()).filter(entry => entry.untracked && paths.some(path => path === "." || entry.path === path || entry.path.startsWith(`${path}/`)));
            for (const entry of untracked) {
                output.push(await this.repository.run(["diff", "--no-index", "--no-ext-diff", "--no-textconv", "--no-color", "--", "/dev/null", join(this.repository.root, entry.path)], { allowedExitCodes: [1] }));
            }
            const text = output.filter(Boolean).join("\n");
            if (!newTab) { showOutput(this.app, "Diff with Working Tree", text); return; }
            const leaf = this.app.workspace.getLeaf("tab");
            await leaf.setViewState({ type: DIFF_VIEW, active: true, state: { title: paths.length === 1 ? `Diff: ${paths[0]}` : "Git Diff", text } });
            await this.app.workspace.revealLeaf(leaf);
        });
    }

    showHistory(paths) {
        return this.act(async () => {
            const output = await this.repository.run(["log", "-100", "--date=short", "--format=%h  %ad  %an%n%s", "--stat", "--", ...paths]);
            showOutput(this.app, "Git History", output || "No commits for this selection.");
        });
    }

    saveDraft() {
        clearTimeout(this.draftTimer);
        this.draftTimer = setTimeout(() => { void this.plugin.saveData({ ...this.draft, changelists: this.changelists.serialize() }).catch(error => new Notice(`Could not save commit draft: ${error.message}`)); }, 300);
    }

    dispose() {
        this.disposed = true;
        this.app.workspace.containerEl.ownerDocument.defaultView.cancelAnimationFrame(this.ribbonFrame);
        clearTimeout(this.refreshTimer); clearTimeout(this.draftTimer);
        void this.plugin.saveData({ ...this.draft, changelists: this.changelists.serialize() }).catch(() => {});
        this.repository.dispose();
        this.explorerStatus.dispose();
        this.app.workspace.detachLeavesOfType(COMMIT_VIEW);
        this.app.workspace.detachLeavesOfType(DIFF_VIEW);
        this.ribbon.remove();
        this.views.clear();
        this.ready = false;
        this.app.workspace.trigger("patchwork-git:refreshed");
    }
}
