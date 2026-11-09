import { GitTaskModal } from "./ui/task-modal";
import { updateCurrentBranch } from "./utils/update-branch.js";

/** Preview an exact source commit and remote destination before transferring updates. */
export class GitNetworkModal extends GitTaskModal {
    constructor(controller, kind, branch, options = {}) { super(controller, kind === "push" ? "Push Commits" : "Update"); this.kind = kind; this.branch = branch; this.defaults = options; }
    onOpen() {
        super.onOpen();
        this.remote = this.field("Remote", "", []);
        this.target = this.field("Remote branch");
        if (this.kind === "pull") this.strategy = this.field("Update strategy", this.controller.plugin.settingsStore.preferences.updateMethod === "rebase" ? "rebase" : "merge", [["merge", "Merge"], ["rebase", "Rebase"]]);
        if (this.strategy && ["merge", "rebase"].includes(this.defaults.strategy)) this.strategy.value = this.defaults.strategy;
        if (this.kind === "pull") this.saveChanges = this.field("Local changes", "save", [["save", "Save and restore local changes (including staged state)"], ["clean", "Require a clean working tree"]]);
        if (this.kind === "pull") this.trackUpdate = this.field("Tracking branch", "keep", [["keep", "Keep existing upstream"], ["set", "Set selected branch as upstream"]]);
        if (this.kind === "push") this.setUpstream = this.field("Tracking branch", "keep", [["keep", "Keep existing upstream"], ["set", "Set destination as upstream"]]);
        this.preview = this.body.createDiv({ cls: "pw-git-network-preview" });
        this.remote.onchange = this.target.oninput = () => { this.plan = undefined; this.preview.setText(this.kind === "pull" ? "Click Update to fetch and update from this destination." : "Refresh after changing the destination."); this.updateActions(); };
        if (this.kind === "push") this.button("Refresh Preview", () => this.load());
        if (this.kind === "push") this.button("Fetch", async () => {
            const remote = this.remote.value;
            if (!remote || !(await this.repo.snapshot()).remotes.includes(remote)) throw new Error("Select a configured remote.");
            const cancellation = new AbortController();
            await this.change(() => this.repo.run(["fetch", "--", remote], { signal: cancellation.signal }), "Fetch", { independent: true, signal: cancellation.signal, onCancel: () => cancellation.abort() });
            await this.load();
        });
        this.transferButton = this.button(this.kind === "push" ? "Push" : "Update", () => this.transfer(), true);
        this.updateActions();
        void this.perform(() => this.initialize());
    }
    updateActions() {
        if (!this.transferButton) return;
        if (this.kind === "pull") {
            this.transferButton.disabled = this.pending || !this.remote.value || !this.target.value.trim() || !!this.controller.operation;
            this.transferButton.title = this.controller.operation ? "Finish or abort the active Git operation first." : "Fetch and update from the selected remote branch.";
            return;
        }
        this.transferButton.disabled = this.pending || !this.plan || (this.kind === "push" && !this.plan.transferCount) || !!this.plan.blockedReason;
        this.transferButton.title = !this.plan ? "Refresh the preview before continuing." : this.plan.blockedReason || (this.kind === "push" && !this.plan.transferCount ? "No commits to transfer." : "");
    }
    async initialize() {
        const snapshot = await this.repo.snapshot(); this.validate();
        this.branch ??= snapshot.current;
        if (!snapshot.local.includes(this.branch)) throw new Error("Check out a local branch first.");
        this.nonCurrentUpdate = this.kind === "pull" && this.defaults.selectedUpdate && this.branch !== snapshot.current;
        if (this.nonCurrentUpdate) {
            this.strategy.closest("label").hidden = true;
            this.saveChanges.closest("label").hidden = true;
        }
        this.source = this.body.createDiv({ cls: "pw-git-task-help", text: `Local branch: ${this.branch}` });
        for (const name of snapshot.remotes) this.remote.createEl("option", { value: name, text: name });
        const tracking = snapshot.upstreams.get(this.branch);
        if (this.setUpstream) this.setUpstream.value = tracking ? "keep" : "set";
        const remote = snapshot.remotes.filter(name => tracking?.startsWith(name + "/")).sort((a, b) => b.length - a.length)[0];
        this.remote.value = remote || snapshot.remotes[0] || "";
        this.target.value = remote ? tracking.slice(remote.length + 1) : this.branch;
        if (this.defaults.remote && snapshot.remotes.includes(this.defaults.remote)) { this.remote.value = this.defaults.remote; this.target.value = this.defaults.target || this.branch; }
        if (!snapshot.remotes.length) throw new Error("No remotes configured. Add a remote using Manage Remotes first.");
        await this.load();
    }
    async destination() {
        const remote = this.remote.value, branch = this.target.value.trim();
        const snapshot = await this.repo.snapshot(); this.validate();
        if (!snapshot.remotes.includes(remote) || remote.startsWith("-")) throw new Error("Select a configured remote.");
        await this.repo.run(["check-ref-format", `refs/heads/${branch}`]);
        if (!branch || branch.startsWith("-")) throw new Error("Enter a valid branch name.");
        return { remote, branch, current: snapshot.current };
    }
    async load() {
        this.plan = undefined;
        this.updateActions();
        const { remote, branch, current } = await this.destination();
        const source = (await this.repo.run(["rev-parse", "--verify", `refs/heads/${this.branch}`])).trim();
        if (this.kind === "pull") {
            this.validate();
            this.preview.setText(`Update ${this.branch} from ${remote}/${branch}. Fetch runs when you click Update, including when the branch is already up to date.`);
            this.plan = { remote, branch, current, source, blockedReason: this.controller.operation ? "Finish or abort the active Git operation first." : current !== this.branch && !this.defaults.selectedUpdate ? "Check out this branch before updating." : "" };
            this.status.setText(this.nonCurrentUpdate ? "Fast-forward the selected branch without switching the current branch. Diverged branches require separate merge or rebase." : "Merge or rebase using the latest remote commits. Saved local changes are retained if conflicts need recovery.");
            return;
        }
        const listing = await this.repo.run(["ls-remote", "--heads", "--", remote, `refs/heads/${branch}`]);
        const tip = listing.split(/\r?\n/).find(line => line.split("\t")[1] === `refs/heads/${branch}`)?.split("\t")[0];
        if (tip) {
            try { await this.repo.run(["cat-file", "-e", `${tip}^{commit}`]); }
            catch { throw new Error("The remote has commits that are not available locally. Click Fetch, then preview again."); }
        }
        if (this.kind === "pull" && !tip) throw new Error("The remote branch does not exist.");
        const counts = tip ? (await this.repo.run(["rev-list", "--left-right", "--count", `${source}...${tip}`])).trim().split(/\s+/).map(Number) : [Number((await this.repo.run(["rev-list", "--count", source])).trim()), 0];
        this.validate();
        this.preview.empty();
        this.preview.createEl("strong", { text: `${remote}/${branch} · ${counts[0]} outgoing · ${counts[1]} incoming` });
        for (const [title, range, count] of [["Outgoing", tip ? `${tip}..${source}` : source, counts[0]], ["Incoming", tip ? `${source}..${tip}` : undefined, counts[1]]]) {
            const section = this.preview.createDiv();
            section.createEl("h4", { text: `${title} (${count})` });
            const content = section.createEl("pre", { cls: "pw-git-task-list", text: count ? "" : "No commits." });
            if (!count) continue;
            let offset = 0;
            const more = this.button("Show more commits", async () => {
                const log = await this.repo.run(["log", "-200", `--skip=${offset}`, "--format=%h %s", range, "--"]);
                this.validate();
                if (!section.isConnected) return;
                content.appendText(log); offset += 200; more.hidden = offset >= count;
            }, false, section);
            const log = await this.repo.run(["log", "-200", "--format=%h %s", range, "--"]);
            this.validate(); content.setText(log); offset = 200; more.hidden = offset >= count;
        }
        const blockedReason = this.controller.operation ? "Finish or abort the active Git operation first."
            : this.kind === "pull" && current !== this.branch && !this.defaults.selectedUpdate ? "Check out this branch before updating."
            : "";
        this.validate();
        this.plan = { remote, branch, current, source, tip, blockedReason, transferCount: counts[this.kind === "push" ? 0 : 1] };
        this.status.setText(this.kind === "push" ? "Push uses the previewed commit and selected tracking preference. No force push." : "Local changes can be saved and restored with their staged state. If conflicts occur, the saved stash is retained for recovery.");
    }
    async transfer() {
        if (this.kind === "pull") await this.load();
        const plan = this.plan;
        if (!plan) throw new Error("Refresh the preview before continuing.");
        const strategy = this.strategy?.value;
        await this.change(async () => {
            await this.repo.assertNoOperation();
            const destination = await this.destination();
            const head = (await this.repo.run(["rev-parse", "--verify", `refs/heads/${this.branch}`])).trim();
            if (head !== plan.source || destination.remote !== plan.remote || destination.branch !== plan.branch || destination.current !== plan.current) throw new Error("The branch or destination changed. Refresh the preview.");
            if (this.kind === "push") {
                await this.repo.run(["push", "--porcelain", "--", plan.remote, `${plan.source}:refs/heads/${plan.branch}`]);
                this.plan = undefined;
                try { if (this.setUpstream.value === "set") {
                    await this.repo.run(["config", `branch.${this.branch}.remote`, plan.remote]);
                    await this.repo.run(["config", `branch.${this.branch}.merge`, `refs/heads/${plan.branch}`]);
                } } catch (error) { throw new Error(`Push succeeded, but upstream configuration failed: ${error.message}. Refresh before another transfer.`); }
            } else {
                if (destination.current !== this.branch && !this.defaults.selectedUpdate) throw new Error("Check out the selected branch before updating it.");
                if (destination.current !== this.branch) {
                    await this.controller.branchActions.update({ ref: this.branch, current: destination.current, remote: plan.remote, tracking: `${plan.remote}/${plan.branch}`, isRemote: false });
                    this.updated = (await this.repo.run(["rev-parse", "--verify", `refs/heads/${this.branch}`])).trim() !== plan.source;
                } else {
                    await this.controller.plugin.settingsStore.savePreferences({ updateMethod: strategy });
                    this.updated = await updateCurrentBranch(this.repo, { branch: this.branch, remote: plan.remote, target: plan.branch, strategy, saveChanges: this.saveChanges.value === "save" });
                }
                if (this.trackUpdate.value === "set") {
                    await this.repo.run(["config", `branch.${this.branch}.remote`, plan.remote]);
                    await this.repo.run(["config", `branch.${this.branch}.merge`, `refs/heads/${plan.branch}`]);
                }
            }
        });
        this.plan = undefined;
        this.status.setText(this.kind === "push" ? "Push completed." : this.updated ? "Update completed." : "Already up to date.");
    }
}
