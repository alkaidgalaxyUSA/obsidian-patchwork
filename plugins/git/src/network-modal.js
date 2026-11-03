import { GitTaskModal } from "./ui/task-modal";

/** Preview an exact source commit and remote destination before transferring updates. */
export class GitNetworkModal extends GitTaskModal {
    constructor(controller, kind, branch) { super(controller, kind === "push" ? "Push Commits" : "Update Project"); this.kind = kind; this.branch = branch; }
    onOpen() {
        super.onOpen();
        this.remote = this.field("Remote", "", []);
        this.target = this.field("Remote branch");
        if (this.kind === "pull") this.strategy = this.field("Update strategy", "ff", [["ff", "Fast-forward only"], ["merge", "Merge"], ["rebase", "Rebase"]]);
        this.preview = this.body.createDiv({ cls: "pw-git-network-preview" });
        this.remote.onchange = this.target.oninput = () => { this.plan = undefined; this.preview.setText("Refresh the preview after changing the destination."); this.updateActions(); };
        this.button("Refresh Preview", () => this.load());
        this.button("Fetch", async () => {
            const remote = this.remote.value;
            if (!remote || !(await this.repo.snapshot()).remotes.includes(remote)) throw new Error("Select a configured remote.");
            await this.change(() => this.repo.run(["fetch", "--", remote]));
            await this.load();
        });
        this.transferButton = this.button(this.kind === "push" ? "Push" : "Update", () => this.transfer(), true);
        this.updateActions();
        void this.perform(() => this.initialize());
    }
    updateActions() {
        if (!this.transferButton) return;
        this.transferButton.disabled = this.pending || !this.plan || !this.plan.transferCount || !!this.plan.blockedReason;
        this.transferButton.title = !this.plan ? "Refresh the preview before continuing." : this.plan.blockedReason || (!this.plan.transferCount ? "No commits to transfer." : "");
    }
    async initialize() {
        const snapshot = await this.repo.snapshot(); this.validate();
        this.branch ??= snapshot.current;
        if (!snapshot.local.includes(this.branch)) throw new Error("Check out a local branch first.");
        this.source = this.body.createDiv({ cls: "pw-git-task-help", text: `Local branch: ${this.branch}` });
        for (const name of snapshot.remotes) this.remote.createEl("option", { value: name, text: name });
        const tracking = snapshot.upstreams.get(this.branch);
        const remote = snapshot.remotes.filter(name => tracking?.startsWith(name + "/")).sort((a, b) => b.length - a.length)[0];
        this.remote.value = remote || snapshot.remotes[0] || "";
        this.target.value = remote ? tracking.slice(remote.length + 1) : this.branch;
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
        const listing = await this.repo.run(["ls-remote", "--heads", "--", remote, `refs/heads/${branch}`]);
        const tip = listing.split(/\r?\n/).find(line => line.split("\t")[1] === `refs/heads/${branch}`)?.split("\t")[0];
        if (tip) {
            try { await this.repo.run(["cat-file", "-e", `${tip}^{commit}`]); }
            catch { throw new Error("The remote has commits that are not available locally. Click Fetch, then preview again."); }
        }
        if (this.kind === "pull" && !tip) throw new Error("The remote branch does not exist.");
        const counts = tip ? (await this.repo.run(["rev-list", "--left-right", "--count", `${source}...${tip}`])).trim().split(/\s+/).map(Number) : [Number((await this.repo.run(["rev-list", "--count", source])).trim()), 0];
        const range = this.kind === "push" ? tip ? `${tip}..${source}` : source : `${source}..${tip}`;
        const log = await this.repo.run(["log", "-200", "--format=%h %s", range, "--"]);
        this.validate();
        this.preview.empty();
        this.preview.createEl("strong", { text: `${remote}/${branch} · ${counts[0]} outgoing · ${counts[1]} incoming` });
        this.preview.createEl("pre", { cls: "pw-git-task-list", text: log || "No commits to transfer." });
        const blockedReason = this.controller.operation ? "Finish or abort the active Git operation first."
            : this.kind === "pull" && current !== this.branch ? "Check out this branch before updating."
            : this.kind === "pull" && (await this.repo.status()).length ? "Commit or stash local changes, then refresh the preview." : "";
        this.validate();
        this.plan = { remote, branch, current, source, tip, blockedReason, transferCount: counts[this.kind === "push" ? 0 : 1] };
        this.status.setText(this.kind === "push" ? "Push uses the previewed commit. A new destination is set as this branch's upstream. No force push." : "Local changes must be committed or stashed before updating. Conflicts can be resolved in Commit.");
    }
    async transfer() {
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
                try {
                    await this.repo.run(["config", `branch.${this.branch}.remote`, plan.remote]);
                    await this.repo.run(["config", `branch.${this.branch}.merge`, `refs/heads/${plan.branch}`]);
                } catch (error) { throw new Error(`Push succeeded, but upstream configuration failed: ${error.message}. Refresh before another transfer.`); }
            } else {
                if (destination.current !== this.branch) throw new Error("Check out the selected branch before updating it.");
                if ((await this.repo.status()).length) throw new Error("Commit or stash local changes before updating.");
                await this.repo.run(["fetch", "--", plan.remote, `refs/heads/${plan.branch}`]);
                const fetched = (await this.repo.run(["rev-parse", "FETCH_HEAD"])).trim();
                if (fetched !== plan.tip) throw new Error("The remote branch changed. Refresh the preview before updating.");
                const args = strategy === "rebase" ? ["rebase", fetched] : ["merge", ...(strategy === "ff" ? ["--ff-only"] : ["--no-edit"]), fetched];
                await this.repo.run(args);
            }
        });
        this.plan = undefined;
        this.status.setText(this.kind === "push" ? "Push completed." : "Update completed.");
    }
}
