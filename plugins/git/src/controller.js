import { Notice, normalizePath } from "obsidian";
import { isAbsolute, relative, resolve } from "node:path";
import { getServiceRegistry } from "../../utils/service-registry";
import { getWindowContext } from "../../utils/windows";
import { Repository } from "./repository";
import { COMMIT_VIEW, CommitView } from "./commit/commit-view";
import { addGitMenu } from "./context-menu";
import { choose, confirm, prompt, showOutput } from "./dialogs";
import { GitSettings } from "./settings";
import { GitSnapshots } from "./status";
import { Changelists } from "./changelists";
import { DIFF_VIEW, DiffView } from "./diff-view";
import { BranchActions } from "./branch-actions";
import { GitProgress } from "./integrations/progress";
import { GitOperations } from "./operations";
import { currentUpdateTarget, updateCurrentBranch } from "./utils/update-branch.js";
import { GitNetworkModal } from "./network-modal";
import { GitCompareModal } from "./compare-modal";
import { GitDiffModal } from "./diff-modal";
import { GitConflictModal } from "./conflict-modal";
import { GitStashModal } from "./stash-modal";
import { GitWorktreeModal } from "./worktree-modal";
import { GitTagsModal } from "./tags-modal";
import { GitRebaseModal } from "./rebase-modal";
import { GitRebaseAmendModal } from "./rebase-amend-modal";
import { GitResetModal } from "./reset-modal";
import { GitRepositoriesModal } from "./repositories-modal";
import { openGitDialog } from "./utils/portals";
import { GitMoveTracker } from "./move-tracker";
import { gitErrorSummary } from "./utils/git-error-summary";
import { readBranchSync } from "./utils/branch-sync";
import { workingDiff } from "./utils/working-diff";

export class GitController {
    constructor(plugin, vaultPath, data) {
        this.plugin = plugin;
        this.app = plugin.app;
        this.repository = new Repository(vaultPath, typeof plugin.settingsStore.preferences.executable === "string" ? plugin.settingsStore.preferences.executable : "git");
        const activeRepository = plugin.settingsStore.preferences.activeRepository;
        if (typeof activeRepository === "string" && isAbsolute(activeRepository)) {
            const inside = relative(vaultPath, activeRepository), parent = relative(activeRepository, vaultPath);
            const outside = path => isAbsolute(path) || path === ".." || path.startsWith("../") || path.startsWith("..\\");
            if (!outside(inside) || !outside(parent)) this.repository.discoveryPath = activeRepository;
        }
        this.progress = new GitProgress(this.app);
        this.operations = new GitOperations(this.repository);
        this.commitMode = data?.commitMode === "working" ? "working" : "staged";
        this.branchActions = new BranchActions(this);
        this.snapshots = new GitSnapshots(this);
        this.ignored = [];
        this.views = new Set();
        this.logTools = new Map();
        this.dialogs = new Set();
        this.entries = [];
        this.selected = new Set();
        this.known = new Set();
        this.collapsed = new Set(Array.isArray(plugin.settingsStore.preferences.commitCollapsed) ? plugin.settingsStore.preferences.commitCollapsed : []);
        this.changelists = new Changelists(data?.changelists);
        this.draft = { message: typeof data?.message === "string" ? data.message : "", amend: !!data?.amend };
        this.busy = false;
        this.stashCount = 0;
        this.ready = false;
        this.initialDraftRepository = data?.draftRepository;
        this.lastOpenedFile = this.app.workspace.getActiveFile() ?? this.app.workspace.getMostRecentLeaf()?.view.file;
    }

    install() {
        const plugin = this.plugin;
        plugin.registerView(COMMIT_VIEW, leaf => new CommitView(leaf, this));
        plugin.registerView(DIFF_VIEW, leaf => new DiffView(leaf, this));
        const commands = [
            ["open-commit", "Commit…", () => this.open()],
            ["open-history", "Open Git history", () => this.openHistory()],
            ["refresh", "Refresh changes", () => this.refresh()],
            ["fetch", "Fetch", () => this.network("fetch")],
            ["pull", "Update", () => this.network("pull")],
            ["push", "Push…", () => this.network("push")],
            ["create-branch", "New Branch…", () => this.newBranch()],
            ["init-repo", "Initialize Repository…", () => this.initialize()],
            ...["stashes", "worktrees", "tags", "rebase", "reset", "repositories"].map(name => [`manage-${name}`, `Manage ${name}…`, () => this.openManager(name)]),
        ];
        for (const [id, name, callback] of commands) plugin.addCommand({ id, name, callback: () => { void callback(); } });
        plugin.registerEvent(this.app.workspace.on("file-menu", (menu, file, source) => this.fileMenu(menu, [file], source)));
        plugin.registerEvent(this.app.workspace.on("files-menu", (menu, files, source) => this.fileMenu(menu, files, source)));
        plugin.registerEvent(this.app.workspace.on("file-open", file => { if (file) this.lastOpenedFile = file; }));
        for (const event of ["create", "delete", "rename", "modify"]) {
            plugin.registerEvent(this.app.vault.on(event, () => this.scheduleRefresh()));
        }
        this.moveTracker = new GitMoveTracker(this);
        plugin.registerDomEvent(window, "focus", () => void this.refresh());
        plugin.registerInterval(window.setInterval(() => { void this.refresh(); }, 5000));
        plugin.addSettingTab(new GitSettings(this.app, plugin, this));
        this.app.workspace.onLayoutReady(() => { if (!this.disposed) { void this.refresh(); } });
    }

    fileMenu(menu, files, source) {
        if (source === "file-explorer-context-menu" && getServiceRegistry(this.app).get("project")) return;
        if (!files.length) return;
        try { addGitMenu(menu, this, files.map(file => this.repository.path(file.path))); }
        catch { /* Files outside the discovered repository do not have Git actions. */ }
    }

    visible(leaf) {
        const dock = this.app.workspace.leftSplit;
        if (!leaf.tabHeaderEl?.classList.contains("is-active")) return false;
        const bounds = leaf.view.containerEl.getBoundingClientRect();
        return !!dock && !dock.collapsed && bounds.width > 0 && bounds.height > 0;
    }

    async open(toggle = false) {
        if (this.opening || this.disposed) return;
        const borders = getServiceRegistry(this.app).get("borders");
        if (borders) {
            const context = getWindowContext(this.app.workspace.containerEl.ownerDocument);
            try { await (toggle ? borders.togglePanel("git:commit", { context, focus: true }) : borders.openPanel("git:commit", { context, focus: true })); }
            catch (error) { new Notice(error.message); }
            return;
        }
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
        finally { this.opening = false; }
    }

    async openSelection(paths) {
        await this.refresh();
        this.commitMode = "working";
        this.saveDraft();
        this.selected = new Set(this.entries.filter(entry => paths.some(path => path === "." || entry.path === path || entry.path.startsWith(`${path}/`))).map(entry => entry.path));
        await this.open(); this.render();
        for (const view of this.views) view.message.focus();
    }

    async newChangelist() {
        const name = await prompt(this, "New Changelist", "Changelist name");
        if (!name || this.disposed) return;
        try {
            this.changelists.create(name);
            this.saveDraft(); this.render();
        } catch (error) { new Notice(error.message); }
    }

    async editChangelist(id) {
        const list = this.changelists.lists.find(list => list.id === id);
        if (!list) return;
        const name = await prompt(this, "Edit Changelist", "Changelist name", list.name);
        if (!name || this.disposed) return;
        try {
            this.changelists.rename(id, name);
            this.saveDraft(); this.render();
        } catch (error) { new Notice(error.message); }
    }

    async moveToChangelist(paths) {
        if (!paths.length) return;
        const list = await choose(this, "Move to Another Changelist", this.changelists.lists);
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
        if (!await confirm(this, "Delete files", `Move ${files.length} selected file(s) to trash? Git will detect tracked files as deleted.`, "Delete")) return;
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
        const destination = await prompt(this, "Create Patch from Local Changes", "Patch path relative to the vault (existing files are not overwritten)", "changes.patch");
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
        this.refreshTimer = setTimeout(() => {
            void this.refresh();
            this.plugin.history?.invalidate();
        }, 500);
    }

    refresh(force = false) {
        if (this.disposed || (this.busy && !force)) return Promise.resolve();
        if (this.refreshing) return this.refreshing;
        this.refreshing = this.readStatus().finally(() => { this.refreshing = undefined; });
        return this.refreshing;
    }

    async readStatus() {
        try {
            if (!this.ready) {
                await this.repository.discover();
                if (this.initialDraftRepository && this.initialDraftRepository !== this.repository.root) {
                    const draft = this.plugin.settingsStore.preferences.repositoryDrafts?.[this.repository.root] || {};
                    this.draft = { message: draft.message || "", amend: !!draft.amend };
                    this.commitMode = draft.commitMode === "working" ? "working" : "staged";
                    this.changelists = new Changelists(draft.changelists);
                    for (const view of this.views) { view.message.value = this.draft.message; view.amend.checked = this.draft.amend; }
                }
                this.initialDraftRepository = undefined;
            }
            const [entries, branch, ignored, head, stashes, operation, refs, remotes] = await Promise.all([this.repository.status(), this.repository.branch(), this.repository.ignored(), this.repository.head(), this.repository.run(["stash", "list", "--format=%gd"]),
                this.operations.state(), this.repository.run(["for-each-ref", "--format=%(refname)%09%(objectname)%09%(upstream)"]), this.repository.run(["remote"])]);
            const sync = await readBranchSync(this.repository, refs, remotes.trim().split(/\r?\n/).filter(Boolean));
            if (this.disposed) return;
            this.branchSync = sync.get(branch);
            this.stashCount = stashes.trim().split("\n").filter(Boolean).length;
            const changed = JSON.stringify(entries) !== JSON.stringify(this.entries) || JSON.stringify(operation) !== JSON.stringify(this.operation) || this.error || !this.ready;
            const historyChanged = this.head !== head || this.refs !== refs;
            this.operation = operation;
            this.head = head; this.refs = refs;
            const ignoredChanged = JSON.stringify(ignored) !== JSON.stringify(this.ignored);
            for (const entry of entries) if (!this.known.has(entry.path) && !entry.untracked) this.selected.add(entry.path);
            const paths = new Set(entries.map(entry => entry.path));
            for (const path of this.selected) if (!paths.has(path)) this.selected.delete(path);
            this.known = paths;
            this.entries = entries; this.error = ""; this.ready = true;
            this.ignored = ignored;
            if (this.branch !== branch || changed || ignoredChanged || historyChanged) {
                this.branch = branch;
                this.app.workspace.trigger("patchwork-git:refreshed");
            }
            this.snapshots.publish();
            if (changed) this.render();
            if (changed || historyChanged) this.plugin.history?.invalidate();
        } catch (error) {
            if (this.disposed) return;
            this.error = error.message; this.ready = false; this.render();
            this.ignored = [];
            this.snapshots.publish();
            this.app.workspace.trigger("patchwork-git:refreshed");
        }
    }

    render() { for (const view of this.views) view.render(); this.snapshots.publish(); }

    async act(action, rethrow = false, progress = {}) {
        if (this.busy || this.disposed) {
            if (rethrow) throw new Error("Git is busy or unavailable. Try again when the operation finishes.");
            return;
        }
        this.busy = true; this.render();
        let finishProgress;
        try {
            finishProgress = this.progress.start(progress.title || "Git: Working", progress.document || this.app.workspace.containerEl.ownerDocument, progress.onCancel);
            if (!progress.independent) await this.refreshing;
            progress.signal?.throwIfAborted();
            return await this.repository.mutate(action);
        } catch (error) {
            if (error.name === "AbortError" && !rethrow) { new Notice("Git: Cancelled."); return; }
            if (rethrow) throw error;
            const details = error.message ?? String(error);
            const summary = gitErrorSummary(details);
            new Notice(`Git: ${summary}`, 10000);
            if (summary !== details) showOutput(this, "Git operation failed", details);
        }
        finally {
            finishProgress?.();
            this.busy = false;
            if (!this.disposed) {
                this.render();
                if (progress.independent) void this.refresh(true);
                else await this.refresh(true);
                this.plugin.history?.invalidate();
            }
        }
    }

    async commit(push) {
        if (this.busy) return;
        this.validationRequested = true;
        if (this.commitValidation()) { this.render(); return; }
        const commitAll = this.commitMode === "staged" && this.plugin.settingsStore.preferences.commitAllTracked === true && !this.draft.amend;
        const mode = commitAll ? "working" : this.commitMode;
        const message = this.draft.message, amend = this.draft.amend;
        const selected = new Set(commitAll ? this.entries.filter(entry => !entry.untracked).map(entry => entry.path) : this.selected);
        const root = this.repository.root, head = this.head;
        const options = this.commitOptions?.root === root ? this.commitOptions : {};
        const checks = { checkWhitespace: this.plugin.settingsStore.preferences.checkWhitespace === true,
            signOff: this.plugin.settingsStore.preferences.signOffCommit === true,
            author: options.author, runHooks: options.runHooks !== false };
        if (mode === "working" && this.entries.some(entry => selected.has(entry.path) && entry.staged && entry.code[1] !== " ")
            && !await confirm(this, "Commit all changes in checked files", "Some checked files are partly staged. This mode also commits their unstaged changes. To commit only staged hunks, cancel and choose All staged changes.", "Commit all file changes")) return;
        if (amend && !await confirm(this, "Amend commit", `Replace the latest commit using ${mode === "staged" ? "all staged changes" : "all working-tree changes in the checked files"} and this message? If it was pushed, a normal push may be rejected.`, "Amend")) return;
        let committed = false;
        await this.act(async () => {
            if (this.repository.root !== root || await this.repository.head() !== head) throw new Error("The repository or HEAD changed. Review the commit again.");
            const result = mode === "staged" ? await this.repository.commitStaged(message, amend, checks)
                : await this.repository.commit(selected, message, amend, checks);
            this.draft = { message: "", amend: false };
            this.commitOptions = undefined;
            this.validationRequested = false;
            for (const view of this.views) { view.message.value = ""; view.amend.checked = false; }
            this.saveDraft();
            if (result.warning) { new Notice(result.warning, 15000); return; }
            new Notice("Commit created.");
            committed = true;
        }, false, { title: "Git: Commit" });
        if (committed && push && !this.disposed && this.repository.root === root) this.network("push");
    }

    commitValidation() {
        if (this.operation) return "Finish or abort the active Git operation using the controls above.";
        const all = this.commitMode === "staged" && this.plugin.settingsStore.preferences.commitAllTracked === true && !this.draft.amend;
        const hasFiles = all ? this.entries.some(entry => !entry.untracked && !entry.conflict) : this.commitMode === "staged" ? this.entries.some(entry => entry.staged && !entry.conflict)
            : this.entries.some(entry => this.selected.has(entry.path));
        const hasMessage = !!this.draft.message.trim();
        if (!hasFiles && !this.draft.amend) return "Select files to commit";
        if (this.draft.amend && !this.head) return "There is no commit to amend.";
        if (!hasMessage) return "Select files to commit";
        return "";
    }

    stageSelection(paths, unstage = false) {
        if (!paths.length) return;
        return this.act(async () => {
            const entries = (await this.repository.status()).filter(entry => paths.includes(entry.path));
            if (entries.some(entry => entry.conflict)) throw new Error("Use Mark resolved for conflicting files.");
            const selected = entries.filter(entry => unstage ? entry.staged : entry.untracked || entry.code[1] !== " ").map(entry => entry.path);
            if (!selected.length) return;
            await (unstage ? this.repository.unstage(selected) : this.repository.stage(selected));
        });
    }

    async resumeOperation(action) {
        const operation = this.operation;
        if (!operation || this.busy) return;
        if (action !== "continue" && !await confirm(this, action === "abort" ? "Abort Git operation" : "Skip current commit",
            action === "abort" ? `Abort ${operation.kind}? Conflict resolution edits may be discarded.` : "Discard the current commit's changes and continue the operation?", action === "abort" ? "Abort" : "Skip")) return;
        await this.act(() => this.operations.resume(operation, action));
    }

    amendRebase() {
        if (this.busy || this.operation?.kind !== "rebase" || !this.operation.editing) return;
        openGitDialog(this, new GitRebaseAmendModal(this));
    }

    async markResolved(path) {
        const operation = this.operation;
        if (this.busy || !await confirm(this, "Mark resolved", `Stage the current contents of ${path} as the resolution? If the file was deleted, keep the deletion.`, "Mark resolved")) return;
        await this.act(() => this.operations.markResolved(operation, path));
    }

    resolveConflict(path) { openGitDialog(this, new GitConflictModal(this, path)); }

    openManager(name, revision) {
        const factories = { stashes: () => new GitStashModal(this), worktrees: () => new GitWorktreeModal(this), tags: () => new GitTagsModal(this),
            rebase: () => new GitRebaseModal(this, revision), reset: () => new GitResetModal(this, revision), repositories: () => new GitRepositoriesModal(this) };
        if (factories[name]) openGitDialog(this, factories[name]());
    }

    async switchRepository(probe) {
        if (this.busy || this.disposed) throw new Error("Wait for the active Git operation before switching repositories.");
        await this.refreshing;
        const preferences = this.plugin.settingsStore.preferences;
        const drafts = { ...(preferences.repositoryDrafts || {}), [this.repository.root]: { ...this.draft, commitMode: this.commitMode, changelists: this.changelists.serialize() } };
        const next = drafts[probe.root] || {};
        await this.act(async () => {
            this.repository.discoveryPath = probe.root; this.repository.root = probe.root; this.repository.gitDir = probe.gitDir; this.repository.indexPath = probe.indexPath;
            this.draft = { message: next.message || "", amend: !!next.amend };
            this.commitMode = next.commitMode === "working" ? "working" : "staged";
            this.changelists = new Changelists(next.changelists);
            this.entries = []; this.ignored = []; this.selected.clear(); this.known.clear(); this.head = undefined; this.refs = undefined;
            this.ready = true; this.error = "";
            for (const view of this.views) { view.message.value = this.draft.message; view.amend.checked = this.draft.amend; }
            await this.plugin.settingsStore.savePreferences({ repositoryDrafts: drafts, activeRepository: probe.root });
        }, true);
        this.plugin.history.reset(); await this.refresh(true); this.saveDraft();
    }

    async updateProject(document = this.app.workspace.containerEl.ownerDocument) {
        let chooseDestination = false;
        const root = this.repository.root;
        await this.act(async () => {
            await this.repository.assertNoOperation();
            const snapshot = await this.repository.snapshot();
            if (!snapshot.remotes.length) throw new Error("No remotes configured. Add a remote before updating.");
            const target = currentUpdateTarget(snapshot);
            if (!target) { chooseDestination = true; return; }
            const updated = await updateCurrentBranch(this.repository, {
                ...target, strategy: this.plugin.settingsStore.preferences.updateMethod === "rebase" ? "rebase" : "merge",
            });
            new Notice(updated ? `Updated ${target.branch} from ${target.remote}/${target.target}.` : `${target.branch} is already up to date.`);
        }, false, { title: "Git: Update", document });
        if (chooseDestination && !this.disposed && this.repository.root === root) {
            openGitDialog(this, new GitNetworkModal(this, "pull"));
        }
    }

    network(action, branch, options, document = this.app.workspace.containerEl.ownerDocument) {
        if (action === "pull" && !branch && !options) return this.updateProject(document);
        if (["push", "pull"].includes(action)) {
            openGitDialog(this, new GitNetworkModal(this, action, branch, options));
            return;
        }
        const cancellation = new AbortController();
        return this.act(async () => {
            // Respect configured remotes/upstreams; do not force, merge, or rebase silently.
            const args = ["fetch", "--all", "--prune"];
            const output = await this.repository.run(args, { signal: cancellation.signal });
            new Notice(output.trim() || `${action[0].toUpperCase()}${action.slice(1)} completed.`);
        }, false, { title: "Git: Fetch", document, independent: true, signal: cancellation.signal, onCancel: () => cancellation.abort() });
    }

    async newBranch() {
        const name = await prompt(this, "New Branch", "Branch name");
        if (!name) return;
        await this.act(async () => {
            await this.repository.run(["check-ref-format", "--branch", name]);
            await this.repository.run(["switch", "-c", name]);
        });
    }

    async initialize() {
        if (!await confirm(this, "Initialize Repository", `Create a Git repository in ${this.repository.vaultPath}?`, "Initialize")) return;
        await this.act(() => this.repository.run(["init"], { cwd: this.repository.vaultPath }));
    }

    checkout(ref, remote) { return this.act(() => this.repository.checkout(ref, remote)); }

    async rollback(paths) {
        if (!paths.length || this.busy) return;
        if (!await confirm(this, "Rollback changes", `Discard tracked changes in ${paths.join(", ")}? Staged changes will also be discarded. Unversioned files will be kept.`, "Rollback")) return;
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
        const message = askTitle ? await prompt(this, "Shelve Changes", "Shelf name", this.draft.message.trim().split(/\r?\n/)[0] || "Local changes") : this.draft.message;
        if (askTitle && !message) return;
        return this.act(async () => {
            const shelf = await this.repository.shelves.create(paths, message);
            new Notice(`Shelved ${shelf.paths.length} files. Restore them from View Options → Shelved Changes.`);
        });
    }

    async restoreShelf(shelf) {
        if (!await confirm(this, "Restore shelved changes", `Restore ${shelf.title} (${shelf.paths.length} files)? Existing changes to those files must be committed or shelved first.`, "Restore")) return;
        await this.act(async () => {
            const result = await this.repository.shelves.restore(shelf.id);
            new Notice(result.warning || "Shelved changes restored.", result.warning ? 15000 : 5000);
        });
    }

    async showDiff(paths, newTab = false, stage, document = this.app.workspace.containerEl.ownerDocument) {
        if (!paths.length || this.disposed || this.busy) return;
        try {
            if (!newTab) {
                if (document !== this.app.workspace.containerEl.ownerDocument || !document.defaultView || document.defaultView.closed) throw new Error("The invoking window is unavailable.");
                const root = this.repository.root;
                const request = this.diffRequest = (this.diffRequest ?? 0) + 1;
                const current = () => !this.disposed && root === this.repository.root && request === this.diffRequest && document.defaultView && !document.defaultView.closed;
                const head = stage === "unstaged" ? undefined : await this.repository.head();
                if (!current()) return;
                const text = await workingDiff(this, [...paths], stage === "staged", true, stage === "unstaged" ? "index" : "head");
                if (!current()) return;
                await this.openDiffText(text, paths.length === 1 ? paths[0] : "Git Diff", document, {
                    comparisonLabels: { left: stage === "unstaged" ? "Index" : head?.slice(0, 8) || "--------", right: stage === "staged" ? "Index" : "Current Version" },
                }, current);
                return;
            }
            const leaf = this.app.workspace.getLeaf(newTab === "window" ? "window" : "tab");
            await leaf.setViewState({ type: DIFF_VIEW, active: true, state: { title: paths.length === 1 ? `Diff: ${paths[0]}` : "Git Diff", paths, comparison: "working", baseline: stage === "unstaged" ? "index" : "head", staged: stage === "staged" } });
            await this.app.workspace.revealLeaf(leaf);
        } catch (error) { if (!this.disposed) new Notice(`Git: ${error.message}`, 10000); }
    }

    showHistory(paths) { return this.openHistory(paths); }

    compare(left = "HEAD", right = "", paths = []) { openGitDialog(this, new GitCompareModal(this, left, right, paths)); }

    async openDiffText(text, title, document = this.app.workspace.containerEl.ownerDocument, options = {}, isCurrent = () => true) {
        if (this.disposed || !document.defaultView || document.defaultView.closed || text === undefined || !isCurrent()) return;
        if (document !== this.app.workspace.containerEl.ownerDocument) throw new Error("The invoking window is unavailable.");
        const root = this.repository.root;
        const files = options.files ?? await this.plugin.history.git.parseDiff(text);
        if (this.disposed || root !== this.repository.root || !document.defaultView || document.defaultView.closed || !isCurrent()) return;
        openGitDialog(this, new GitDiffModal(this, document, title, text, files, options));
    }

    async openHistory(paths, document = this.app.workspace.containerEl.ownerDocument) {
        if (this.disposed || !document.defaultView) return;
        const borders = getServiceRegistry(this.app).get("borders");
        if (!borders) { new Notice("Enable Borders to open Git Log."); return; }
        try {
            await borders.openPanel("git:log", { context: getWindowContext(document), focus: true });
            if (this.disposed || !document.defaultView) return;
            if (paths?.length) return await this.logTools.get(document)?.openHistory(paths);
            return this.logTools.get(document)?.tabs.active?.pane;
        } catch (error) { if (!this.disposed) new Notice(error.message); }
    }

    saveDraft() {
        if (this.disposed) return;
        clearTimeout(this.draftTimer);
        this.draftTimer = setTimeout(() => { void this.persistDraft().catch(error => new Notice(`Could not save commit draft: ${error.message}`)); }, 300);
    }

    persistDraft() {
        return this.plugin.settingsStore.saveDraft(this.draft.message, this.draft.amend, this.changelists.serialize(), this.commitMode, this.repository.root);
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        clearTimeout(this.refreshTimer); clearTimeout(this.draftTimer);
        void this.persistDraft().catch(error => console.error("Could not save final Git draft.", error));
        this.progress.dispose();
        this.repository.dispose();
        for (const dialog of this.dialogs) dialog.close();
        this.dialogs.clear();
        this.app.workspace.detachLeavesOfType(COMMIT_VIEW);
        this.app.workspace.detachLeavesOfType(DIFF_VIEW);
        this.views.clear();
        this.ready = false;
        this.snapshots.dispose();
        this.app.workspace.trigger("patchwork-git:refreshed");
    }
}
