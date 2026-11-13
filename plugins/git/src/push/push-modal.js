import { Menu, Notice } from "obsidian";
import { basename } from "node:path";
import { Repository } from "../repository";
import { GitTaskModal } from "../ui/task-modal";
import { ChangedFiles } from "../log/changed-files";
import { CommitFileActions } from "../commit/file-actions";
import { choose, confirm, showOutput } from "../dialogs";
import { scopeGitMenu } from "../utils/portals";
import { setIcon, iconName } from "../utils/icons";
import { discoverRoots } from "../utils/discover-roots";
import { enableModalDrag } from "../utils/modal-drag";
import { enableModalResize } from "../utils/modal-resize";
import { updateCurrentBranch } from "../utils/update-branch";
import { defaultPushTarget, readPushPlan, collectPushChanges, pushChangeDiff } from "./push-data";
import { executePush, protectedPushTarget } from "./push-operation";
import { editPushTarget } from "./push-target-modal";

/** Push selection, preview selection and destination editing are independent states. */
export class GitPushModal extends GitTaskModal {
    constructor(controller, branch, options = {}) {
        super(controller, "Push Commits");
        this.branch = branch; this.defaults = options; this.models = []; this.selectedCommits = new Set();
        this.lifetime = new AbortController(); this.disposers = [];
    }
    onOpen() {
        super.onOpen();
        this.modalEl.classList.add("pw-git-push-modal");
        const prefs = this.controller.plugin.settingsStore.preferences;
        if (Number.isFinite(prefs.pushWidth)) this.modalEl.style.width = `${Math.max(600, Math.min(innerWidth - 40, prefs.pushWidth))}px`;
        if (Number.isFinite(prefs.pushHeight)) this.modalEl.style.height = `${Math.max(400, Math.min(innerHeight - 40, prefs.pushHeight))}px`;
        this.disposers.push(enableModalDrag(this.modalEl, this.titleEl), enableModalResize(this.modalEl));
        this.body.classList.add("pw-push-layout");
        this.left = this.body.createDiv({ cls: "pw-push-left" });
        const toolbar = this.left.createDiv({ cls: "pw-log-files-actions" });
        this.iconButton(toolbar, "Refresh", "refresh-cw", () => this.reloadAll());
        this.iconButton(toolbar, "Fetch", "download", () => this.fetch(this.active));
        this.iconButton(toolbar, "Discover Repositories", "folder", () => this.discover());
        this.tree = this.left.createDiv({ cls: "pw-push-commits", attr: { role: "tree", "aria-label": "Outgoing commits" } });
        this.splitter = this.body.createDiv({ cls: "pw-push-splitter", attr: { role: "separator", tabindex: "0", "aria-orientation": "vertical", "aria-label": "Resize commit list" } });
        this.bindSplitter(Number(prefs.pushSplit) || 45);
        this.right = this.body.createDiv({ cls: "pw-push-right" });
        this.pane = {
            controller: this.controller, repository: this.repo,
            button: (...args) => this.iconButton(...args), createMenu: () => this.createMenu(),
            savePreferences: values => this.controller.plugin.settingsStore.savePreferences(values),
            openDiff: (_commit, files) => this.report(() => this.openDiff(files)),
        };
        this.files = new ChangedFiles(this.pane, this.right, { previewOnly: true, fileMenu: (menu, file) => this.fileMenu(menu, file) });
        const fileToolbar = this.right.querySelector(".pw-log-files-actions");
        this.iconButton(fileToolbar, "Edit Source", "pencil", () => this.editSource([...this.files.selected]));
        this.iconButton(fileToolbar, "Show Commit Details", "info", () => {
            this.details.hidden = !this.details.hidden;
            return this.controller.plugin.settingsStore.savePreferences({ pushShowDetails: !this.details.hidden });
        });
        this.details = this.right.createEl("pre", { cls: "pw-push-details" });
        this.details.hidden = prefs.pushShowDetails === false;
        this.parents = this.right.createEl("select", { cls: "pw-push-parents", attr: { "aria-label": "Compare merge against parent" } });
        this.parents.hidden = true;
        this.parents.onchange = () => { if (this.mergeCommit) void this.report(() => this.select(this.active, this.mergeCommit, { parent: this.parents.value })); };
        this.banner = this.contentEl.createDiv({ cls: "pw-push-banner", attr: { role: "status" } });
        this.contentEl.insertBefore(this.banner, this.actions);
        const options = this.contentEl.createDiv({ cls: "pw-push-options" });
        this.contentEl.insertBefore(options, this.actions);
        const tags = options.createEl("label", { text: "Push tags: " });
        this.tags = tags.createEl("select", { attr: { "aria-label": "Push tags" } });
        for (const [value, text] of [["none", "None"], ["all", "All"], ["follow", "Follow annotated tags"]]) this.tags.createEl("option", { value, text });
        this.tags.value = ["all", "follow"].includes(prefs.pushTags) ? prefs.pushTags : "none";
        this.tags.onchange = () => this.updateActions();
        this.hooks = this.checkbox(options, "Run Git hooks", true);
        this.previewOption = this.checkbox(options, "Preview before Commit and Push", prefs.previewCommitPush !== false);
        this.previewOption.onchange = () => void this.controller.plugin.settingsStore.savePreferences({ previewCommitPush: this.previewOption.checked }).catch(error => new Notice(error.message));
        this.controls.push(this.tags, this.hooks, this.previewOption);
        this.pushButton = this.button("Push", () => this.transfer(false), true);
        this.forceButton = this.button("▾", () => {
            const menu = this.createMenu();
            menu.addItem(item => item.setTitle("Force Push…").setDisabled(!this.canForce()).onClick(() => void this.perform(() => this.transfer(true))));
            const rect = this.forceButton.getBoundingClientRect(); menu.showAtPosition({ x: rect.left, y: rect.bottom });
        }, true);
        this.forceButton.setAttribute("aria-label", "More push actions");
        setIcon(this.forceButton, "chevron-down");
        this.updateActions();
        void this.report(async () => {
            await this.addRepository(this.repo, true, this.branch, this.defaults);
            await this.reloadAll();
        });
        const poll = setInterval(() => void this.checkSources(), 2500);
        this.disposers.push(() => clearInterval(poll));
    }
    checkbox(host, text, checked) {
        const label = host.createEl("label");
        const input = label.createEl("input", { type: "checkbox" }); input.checked = checked;
        label.createSpan({ text }); return input;
    }
    createMenu() { return scopeGitMenu(new Menu(), this.modalEl); }
    iconButton(host, label, icon, action) {
        const button = host.createEl("button", { cls: "clickable-icon", attr: { type: "button", "aria-label": label } });
        setIcon(button, icon);
        button.onclick = event => { if (!this.pending && !this.closed) void this.report(() => action(event)); };
        return button;
    }
    async report(action) {
        try { this.validate(); await action(); }
        catch (error) { if (!this.closed && error.name !== "AbortError") this.status.setText(error.message); }
    }
    mutateRepository(repo, action) { return repo === this.repo ? action() : repo.mutate(action); }
    async checkSources() {
        if (this.closed || this.pending || this.editing || this.checking || this.controller.busy) return;
        this.checking = true;
        try {
            this.validate();
            for (const model of this.models) {
                if (!model.plan || model.loading) continue;
                const hash = (await model.repo.run(["rev-parse", "--verify", `${model.plan.sourceRef}^{commit}`], { signal: this.lifetime.signal })).trim();
                const checkedOut = await model.repo.branch();
                const pushUrl = (await model.repo.run(["remote", "get-url", "--push", "--all", model.plan.remote], { signal: this.lifetime.signal })).trim();
                if (hash !== model.plan.source || checkedOut !== model.plan.checkedOut || pushUrl !== model.plan.pushConfiguration) await this.reload(model);
            }
        } catch (error) {
            if (!this.closed && error.name !== "AbortError") {
                this.status.setText(error.message);
                for (const model of this.models) { model.plan = undefined; model.request?.abort(); model.error = "The repository state changed. Refresh the preview."; }
                this.renderTree(); this.updateActions();
            }
        }
        finally { this.checking = false; }
    }
    bindSplitter(initial) {
        const set = value => {
            this.split = Math.max(25, Math.min(70, value));
            this.body.style.setProperty("--pw-push-split", `${this.split}%`);
            this.splitter.setAttribute("aria-valuenow", String(Math.round(this.split)));
        };
        set(initial);
        let pointer;
        this.splitter.onpointerdown = event => { if (event.button !== 0) return; pointer = event.pointerId; this.splitter.setPointerCapture(pointer); event.preventDefault(); };
        this.splitter.onpointermove = event => {
            if (pointer !== event.pointerId) return;
            const rect = this.body.getBoundingClientRect(); set((event.clientX - rect.left) / rect.width * 100);
        };
        this.splitter.onpointerup = this.splitter.onpointercancel = () => { pointer = undefined; };
        this.splitter.onkeydown = event => { if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return; event.preventDefault(); set(this.split + (event.key === "ArrowLeft" ? -2 : 2)); };
    }
    async addRepository(repo, selected, branch, defaults = {}) {
        const destination = await defaultPushTarget(repo, branch); this.validate();
        destination.remote = defaults.remote || destination.remote; destination.target = defaults.target || destination.target;
        const urls = destination.remote ? (await repo.run(["remote", "get-url", "--push", "--all", destination.remote])).trim().split(/\r?\n/) : [undefined];
        const models = urls.map((pushEndpoint, endpointIndex) => ({ repo, selected, destination: { ...destination, pushEndpoint },
            endpointIndex, endpointCount: urls.length, generation: 0, limit: 200, selectedHashes: new Set(), setUpstream: !destination.tracking }));
        this.models.push(...models);
        this.active ||= models[0];
        return models[0];
    }
    async discover() {
        const roots = await discoverRoots(this.repo.vaultPath, () => this.validate());
        for (const root of roots) {
            if (this.models.some(model => model.repo.root.replaceAll("\\", "/").toLowerCase() === root.replaceAll("\\", "/").toLowerCase())) continue;
            const repo = new Repository(this.repo.vaultPath, this.repo.executable); repo.discoveryPath = root;
            try { await repo.discover(); await this.addRepository(repo, false); }
            catch (error) { repo.dispose(); throw error; }
        }
        await this.reloadAll();
    }
    async reloadAll() { await Promise.all(this.models.map(model => this.reload(model))); }
    async reload(model) {
        model.request?.abort(); model.request = new AbortController();
        const generation = ++model.generation, signal = model.request.signal;
        model.loading = true; model.error = undefined; model.plan = undefined;
        if (this.active === model) { this.previewRequest?.abort(); this.files.clear(); this.details.empty(); }
        this.renderTree(); this.updateActions();
        try {
            model.plan = await readPushPlan(model.repo, model.destination, signal, model.limit, false);
            this.validate(); signal.throwIfAborted();
            this.renderTree();
            if (this.active === model) void this.report(() => this.select(model, undefined, { preserve: model.selectedHashes.size > 0 }));
            const plan = await readPushPlan(model.repo, model.destination, signal, model.limit);
            this.validate();
            if (generation !== model.generation) return;
            model.plan = plan;
        } catch (error) { if (generation === model.generation && !signal.aborted && !this.closed) model.error = error.message; }
        finally {
            if (generation === model.generation && !this.closed) {
                model.loading = false; this.renderTree(); this.updateActions();
                if (this.active === model) void this.report(() => this.select(model, undefined, { preserve: model.selectedHashes.size > 0 }));
            }
        }
    }
    renderTree() {
        if (this.closed) return;
        const scrollTop = this.tree.scrollTop;
        const focused = this.tree.ownerDocument.activeElement;
        const focusedHash = focused?.dataset.hash;
        const focusedRoot = focused?.closest(".pw-push-repository")?.dataset.root;
        const collapsed = new Set([...this.tree.querySelectorAll("details:not([open])")].map(node => node.dataset.root));
        this.tree.empty();
        for (const model of this.models) {
            model.rowElements = new Map();
            const rootKey = `${model.repo.root}:${model.endpointIndex}`;
            const group = this.tree.createEl("details", { cls: "pw-push-repository", attr: { "data-root": rootKey } }); group.open = !collapsed.has(rootKey);
            const row = group.createEl("summary", { cls: "pw-push-target", attr: { role: "treeitem", "aria-expanded": String(group.open) } });
            model.summary = row;
            const chevron = row.createSpan({ cls: "pw-push-chevron" });
            const sync = () => { row.setAttribute("aria-expanded", String(group.open)); setIcon(chevron, group.open ? "chevron-down" : "chevron-right"); };
            group.ontoggle = sync; sync();
            chevron.onclick = event => { event.preventDefault(); event.stopPropagation(); group.open = !group.open; };
            const checkbox = row.createEl("input", { type: "checkbox", attr: { "aria-label": `Push ${model.repo.root}` } }); checkbox.checked = model.selected;
            checkbox.onclick = event => event.stopPropagation();
            checkbox.onchange = () => { model.selected = checkbox.checked; this.updateActions(); };
            const name = row.createSpan({ text: basename(model.repo.root), cls: "pw-push-repository-name" }); name.title = model.repo.root;
            if (model.endpointCount > 1) row.createSpan({ text: `#${model.endpointIndex + 1}`, cls: "pw-push-badge" });
            row.createSpan({ text: model.destination.branch || "HEAD", cls: "pw-push-source" });
            row.createSpan({ text: "→", cls: "pw-push-arrow" });
            const target = row.createEl("button", { text: model.destination.remote ? `${model.destination.remote} : ${model.destination.target}` : "Define remote…", cls: "pw-push-link", attr: { type: "button" } });
            target.onclick = event => { event.preventDefault(); event.stopPropagation(); void this.report(() => this.editTarget(model)); };
            if (model.plan?.isNew) row.createSpan({ text: "New", cls: "pw-push-badge" });
            row.onclick = event => { if (event.target === checkbox || target.contains(event.target)) return; event.preventDefault(); void this.report(() => this.select(model)); };
            const rows = group.createDiv({ attr: { role: "group" } });
            if (model.loading || model.error) rows.createDiv({ cls: "pw-push-state", text: model.loading ? "Loading commits…" : model.error });
            for (const commit of model.plan?.commits || []) {
                const item = rows.createEl("button", { cls: "pw-push-commit", attr: { type: "button", role: "treeitem", "data-hash": commit.hash, "aria-selected": String(this.active === model && model.selectedHashes.has(commit.hash)) } });
                model.rowElements.set(commit.hash, item);
                item.classList.toggle("is-selected", this.active === model && model.selectedHashes.has(commit.hash));
                setIcon(item.createSpan({ cls: "pw-push-commit-icon" }), "git-commit");
                item.createSpan({ cls: "pw-push-subject", text: commit.subject });
                item.createSpan({ cls: "pw-push-hash", text: commit.hash.slice(0, 8) });
                item.onclick = event => void this.report(() => this.select(model, commit, event));
                item.onkeydown = event => this.navigate(event, model, commit);
                item.oncontextmenu = event => { event.preventDefault(); this.commitMenu(event, model, commit); };
            }
            if (model.plan && !model.plan.commits.length) rows.createDiv({ cls: "pw-push-state", text: "No outgoing commits" });
            if (model.plan && model.plan.commits.length < model.plan.count) {
                const more = rows.createEl("button", { cls: "pw-push-link", text: `Show more (${model.plan.count} commits)` });
                more.onclick = () => { model.limit += 200; void this.report(() => this.reload(model)); };
            }
        }
        this.tree.scrollTop = scrollTop;
        if (focusedHash) this.models.find(model => `${model.repo.root}:${model.endpointIndex}` === focusedRoot)?.rowElements.get(focusedHash)?.focus({ preventScroll: true });
    }
    navigate(event, model, commit) {
        const commits = model.plan?.commits || [];
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") { event.preventDefault(); void this.report(() => this.select(model)); return; }
        if (event.key === "Enter") { event.preventDefault(); void this.report(() => this.openDiff(this.files.files)); return; }
        const index = commits.indexOf(commit);
        const next = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: commits.length - 1 }[event.key];
        if (next === undefined) return;
        event.preventDefault(); const target = commits[Math.max(0, Math.min(commits.length - 1, next))];
        void this.report(async () => { await this.select(model, target, event); this.tree.querySelector(`[data-hash="${target.hash}"]`)?.focus(); });
    }
    async select(model, commit, event = {}) {
        this.previewRequest?.abort(); const request = this.previewRequest = new AbortController();
        this.active = model; this.pane.repository = model.repo;
        const plan = model.plan;
        this.files.clear(); this.details.empty(); this.updateActions();
        this.parents.hidden = true; this.mergeCommit = undefined;
        if (!plan) return;
        const commits = plan.commits;
        const selectingAll = !commit && (!event.preserve || model.selectAll);
        if (selectingAll) { model.selectAll = true; model.selectedHashes = new Set(commits.map(item => item.hash)); }
        else if (!commit) model.selectedHashes = new Set(commits.filter(item => model.selectedHashes.has(item.hash)).map(item => item.hash));
        else if (event.shiftKey && model.anchor) {
            const start = commits.findIndex(item => item.hash === model.anchor), end = commits.indexOf(commit);
            model.selectedHashes = new Set(commits.slice(Math.min(Math.max(0, start), end), Math.max(start, end) + 1).map(item => item.hash));
        } else {
            if (!event.ctrlKey && !event.metaKey) model.selectedHashes.clear();
            if ((event.ctrlKey || event.metaKey) && model.selectedHashes.has(commit.hash)) model.selectedHashes.delete(commit.hash);
            else model.selectedHashes.add(commit.hash);
            model.anchor = commit.hash;
        }
        if (commit) model.selectAll = false;
        this.renderTree();
        if (commit && !event.parent) model.rowElements.get(commit.hash)?.focus({ preventScroll: true });
        let selected = commits.filter(item => model.selectedHashes.has(item.hash));
        if (selected.length === 1 && selected[0].parents.length > 1) {
            this.mergeCommit = selected[0];
            this.parents.empty();
            for (const parent of selected[0].parents) this.parents.createEl("option", { value: parent, text: `Changes against ${parent.slice(0, 8)}` });
            this.parents.value = event.parent || selected[0].parents[0]; this.parents.hidden = false;
            selected = [{ ...selected[0], parents: [this.parents.value] }];
        }
        if (selectingAll && plan.count > commits.length) {
            const complete = await readPushPlan(model.repo, model.destination, request.signal, plan.count, plan.verified);
            if (complete.source !== plan.source || complete.tip !== plan.tip) throw new Error("The push range changed. Refresh the preview.");
            selected = complete.commits;
        }
        const changes = await collectPushChanges(model.repo, selected, request.signal);
        this.validate(); request.signal.throwIfAborted();
        this.files.setCommit({ hash: selected.map(item => item.hash).join(":"), parents: [] }, changes);
        this.details.setText(selected.length === 1 ? `${selected[0].message}\n\n${selected[0].hash}\n${selected[0].author} · ${selected[0].date}` : `${selected.length} commits selected`);
    }
    async editTarget(model) {
        if (this.pending) return;
        this.editing = true; this.updateActions();
        let choice;
        try { choice = await editPushTarget(this.controller, model); }
        finally { this.editing = false; this.updateActions(); }
        if (!choice) return;
        this.validate();
        model.destination = { ...model.destination, remote: choice.remote, target: choice.target, pushEndpoint: choice.pushEndpoint };
        model.endpointCount = choice.endpointCount; model.endpointIndex = choice.endpointIndex;
        model.setUpstream = choice.setUpstream;
        await this.reload(model);
    }
    async fetch(model) {
        if (!model?.destination.remote) throw new Error("Select a remote first.");
        const remote = model.destination.remote;
        const pushUrl = model.destination.pushEndpoint || (await model.repo.run(["remote", "get-url", "--push", remote])).trim();
        const fetchUrl = (await model.repo.run(["remote", "get-url", remote])).trim();
        await this.change(async () => {
            const refs = model.plan?.isNew ? model.plan.remoteRefs.map(item => item.ref) : [`refs/heads/${model.destination.target}`];
            if (pushUrl === fetchUrl) await model.repo.run(["fetch", "--", remote], { signal: this.lifetime.signal });
            if (pushUrl !== fetchUrl || model.plan?.needsFetch) {
                for (let offset = 0; offset < refs.length; offset += 100) await model.repo.run(["fetch", "--no-tags", "--", pushUrl, ...refs.slice(offset, offset + 100)], { signal: this.lifetime.signal });
            }
        }, "Fetch");
        await this.reload(model);
    }
    commitMenu(event, model, commit) {
        const menu = this.createMenu();
        menu.addItem(item => item.setTitle("Copy Revision").onClick(() => void this.context.document.defaultView.navigator.clipboard.writeText(commit.hash)));
        menu.addItem(item => item.setTitle("Copy Commit Message").onClick(() => void this.context.document.defaultView.navigator.clipboard.writeText(commit.message)));
        menu.addItem(item => item.setTitle("Push up to Here…").onClick(() => void this.report(async () => {
            if (!await confirm(this.controller, "Push up to Commit", `Use ${commit.hash.slice(0, 8)} as the push source? Later commits will remain local.`, "Use Commit")) return;
            this.validate(); model.destination = { ...model.destination, sourceRef: commit.hash, branch: undefined }; model.setUpstream = false;
            await this.reload(model);
        })));
        menu.showAtMouseEvent(event);
    }
    sourceActions(files) {
        const controller = Object.create(this.controller); controller.repository = this.active.repo;
        return new CommitFileActions(controller, files.filter(file => file.status !== "D").map(file => file.path), this.context.document);
    }
    fileMenu(menu, file) {
        menu.addItem(item => item.setTitle("Show Diff").setIcon(iconName("git-show-diff")).onClick(() => void this.report(() => this.openDiff([file]))));
        const actions = this.sourceActions([file]);
        if (file.status !== "D" && actions.existing(file.path)) menu.addItem(item => item.setTitle("Edit Source").setIcon(iconName("pencil")).onClick(() => void actions.open()));
    }
    async editSource(files) {
        if (!files.length) return;
        const actions = this.sourceActions(files);
        if (actions.paths.length) await actions.open();
    }
    async openDiff(files) {
        if (!files.length || !this.active) return;
        const model = this.active, request = this.previewRequest;
        const patches = [];
        for (const file of files) patches.push(await pushChangeDiff(model.repo, file, request.signal));
        this.validate(); request.signal.throwIfAborted();
        await this.controller.openDiffText(patches.join("\n"), files.length === 1 ? files[0].path : `${files.length} files`, this.context.document, {
            comparisonLabels: files.length === 1 ? { left: files[0].left?.revision?.slice(0, 8) || "Before", right: files[0].right?.revision?.slice(0, 8) || "After" } : undefined,
        }, () => !this.closed && !request.signal.aborted);
    }
    canForce() {
        const selected = this.models.filter(model => model.selected);
        return selected.length > 0 && selected.every(model => model.plan?.verified && !model.plan.needsFetch && !model.loading && !protectedPushTarget(this.controller, model.repo, model.plan));
    }
    updateActions() {
        if (!this.pushButton) return;
        const selected = this.models.filter(model => model.selected);
        const available = selected.length && selected.every(model => model.plan && !model.loading && !model.error && !model.plan.needsFetch);
        this.pushButton.disabled = this.pending || this.editing || !!this.controller.busy || !available;
        this.forceButton.disabled = this.pending || this.editing || !!this.controller.busy || !this.canForce();
        const model = this.active, plan = model?.plan;
        this.banner?.setText(model?.error || (plan?.needsFetch ? "The remote has commits that are not available locally. Fetch before pushing."
            : plan?.remoteError ? `Remote verification failed. The preview uses locally available history. ${plan.remoteError}`
            : plan?.incoming && plan.count ? `${plan.incoming} remote commits are not in this branch. A normal push may be rejected; update or review before Force Push.`
            : plan?.incoming ? `The local branch is behind the remote by ${plan.incoming} commits.` : ""));
        if (this.banner) this.banner.hidden = !this.banner.textContent;
    }
    async transfer(force) {
        const selected = this.models.filter(model => model.selected);
        if (!selected.length || selected.some(model => !model.plan || model.loading)) throw new Error("Wait for the push preview.");
        if (force && (!this.canForce() || !await confirm(this.controller, "Force Push", `Replace the remote history for ${selected.map(model => `${model.plan.remote}/${model.plan.target}`).join(", ")}? The push will be rejected if the reviewed remote version has changed.`, "Force Push"))) return;
        const options = { force, tags: this.tags.value, runHooks: this.hooks.checked };
        const results = [];
        this.operationRequest = new AbortController();
        await this.controller.plugin.settingsStore.savePreferences({ pushTags: options.tags });
        this.operationFinished = this.change(async () => {
            // Nested repositories are pushed before their parents.
            for (const model of [...selected].sort((a, b) => b.repo.root.length - a.repo.root.length)) {
                this.validate();
                const plan = model.plan;
                let result;
                try {
                    result = await this.mutateRepository(model.repo, () => executePush(this.controller, model.repo, plan, { ...options, setUpstream: model.setUpstream }, this.operationRequest.signal));
                    if (result.nonFastForward && !force) result = await this.recoverRejected(model, plan, result, options);
                } catch (error) {
                    result = { success: false, refs: [], message: `${error.message}\nRefresh the remote state before retrying; a cancelled or interrupted push may already have transferred updates.` };
                }
                results.push({ model, plan, result });
                if (!result.success) break;
            }
        }, force ? "Force Push" : "Push", { independent: true, signal: this.operationRequest.signal, onCancel: () => this.operationRequest.abort() });
        await this.operationFinished;
        if (this.closed) { new Notice("Push window closed. Check remote status before retrying any interrupted transfer."); return; }
        for (const { model, result } of results) model.result = result;
        const failed = results.find(entry => !entry.result.success);
        const warnings = results.filter(entry => entry.result.warning);
        if (!failed && !warnings.length) { new Notice(`Push successful: ${results.length} ${results.length === 1 ? "destination" : "destinations"}.`); this.close(); return; }
        this.status.setText(results.map(({ model, result }) => `${basename(model.repo.root)}: ${result.warning || (result.success ? "Push successful" : result.message)}`).join("\n"));
        if (failed) {
            showOutput(this.controller, "Push Result", this.status.textContent);
        }
        await this.reloadAll();
    }
    async recoverRejected(model, initialPlan, initialResult, options) {
        let plan = initialPlan, result = initialResult;
        const snapshot = await model.repo.snapshot();
        if (plan.multipleEndpoints || plan.branch !== snapshot.current || snapshot.upstreams.get(plan.branch) !== `${plan.remote}/${plan.target}` || plan.sourceRef !== `refs/heads/${plan.branch}`) return result;
        if ((await model.repo.run(["remote", "get-url", plan.remote])).trim() !== plan.pushUrl) return result;
        const merges = (await model.repo.run(["rev-list", "--merges", ...(plan.tip && !plan.needsFetch ? [`${plan.tip}..${plan.source}`] : [plan.source, "--not", "--remotes"]), "--"], { signal: this.operationRequest.signal })).trim();
        const choices = [{ name: "Cancel — keep local commits", value: "cancel" }, { name: "Merge and Push", value: "merge" }];
        if (!merges) choices.push({ name: "Rebase and Push", value: "rebase" });
        const choice = await choose(this.controller, merges ? "Push rejected — local merge commits require Merge" : "Push rejected — update and retry", choices);
        if (!choice || choice.value === "cancel") return result;
        for (let attempt = 0; attempt < 3 && result.nonFastForward; attempt++) {
            this.validate(); this.operationRequest.signal.throwIfAborted();
            if (await model.repo.head() !== plan.source) throw new Error("The local branch changed after the rejection. Refresh before updating.");
            if ((await model.repo.run(["remote", "get-url", plan.remote])).trim() !== plan.pushUrl
                || (await model.repo.snapshot()).upstreams.get(plan.branch) !== `${plan.remote}/${plan.target}`) throw new Error("The remote or upstream changed. Review the push destination again.");
            await this.mutateRepository(model.repo, () => updateCurrentBranch(model.repo, { branch: plan.branch, remote: plan.remote, target: plan.target, strategy: choice.value, saveChanges: true }));
            plan = await readPushPlan(model.repo, model.destination, this.operationRequest.signal, model.limit);
            if (plan.needsFetch || !plan.verified) throw new Error("The remote changed or could not be verified after Update. Review the push again.");
            model.plan = plan;
            result = await this.mutateRepository(model.repo, () => executePush(this.controller, model.repo, plan, { ...options, setUpstream: model.setUpstream }, this.operationRequest.signal));
        }
        return result;
    }
    onClose() {
        this.previewRequest?.abort(); this.lifetime.abort(); this.operationRequest?.abort();
        const owned = new Set();
        for (const model of this.models) {
            model.request?.abort();
            if (model.repo !== this.repo && !owned.has(model.repo)) {
                owned.add(model.repo);
                if (this.operationFinished) void this.operationFinished.catch(() => {}).then(() => model.repo.dispose());
                else model.repo.dispose();
            }
        }
        for (const dispose of this.disposers) dispose();
        const rect = this.modalEl.getBoundingClientRect();
        if (rect.width && rect.height) void this.controller.plugin.settingsStore.savePreferences({ pushWidth: rect.width, pushHeight: rect.height, pushSplit: this.split }).catch(() => {});
        super.onClose();
    }
}
