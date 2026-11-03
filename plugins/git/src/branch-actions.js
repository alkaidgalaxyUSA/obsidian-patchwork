import { basename, dirname, isAbsolute, join } from "node:path";
import { prompt, confirm } from "./dialogs";
import { isProtectedRemoteBranch } from "./utils/branch-protection";

/** Local and remote branch operations share the controller's serialized mutation queue. */
export class BranchActions {
    constructor(controller) {
        this.controller = controller;
        this.app = controller.app;
        this.repository = controller.repository;
        this.actions = new Map([
            ["checkout", context => this.checkout(context)],
            ["new-branch", context => this.newBranch(context)],
            ["checkout-rebase", async context => { await this.checkout(context); await this.repository.run(["rebase", context.current]); }],
            ["compare", context => this.compare(context)],
            ["working-diff", context => this.workingDiff(context)],
            ["rebase", context => this.repository.run(["rebase", context.ref])],
            ["merge", context => this.repository.run(["merge", "--no-edit", context.ref])],
            ["worktree", context => this.worktree(context)],
            ["rename", context => this.rename(context)],
            ["delete", context => this.delete(context)],
            ["update", context => this.update(context)],
            ["push", context => this.push(context)],
            ["pull-rebase", context => this.repository.run(["pull", "--rebase", context.remote, context.branch])],
            ["pull-merge", context => this.repository.run(["pull", "--no-rebase", "--no-edit", context.remote, context.branch])],
        ]);
    }

    async context(ref, expectedCurrent, isRemote) {
        const snapshot = await this.repository.snapshot();
        if (!(isRemote ? snapshot.remote : snapshot.local).includes(ref)) throw new Error("This branch no longer exists. Reopen the branch menu.");
        if (snapshot.current !== expectedCurrent) throw new Error("The current branch changed. Reopen the branch menu and try again.");
        const tracking = isRemote ? ref : snapshot.upstreams.get(ref);
        const remote = snapshot.remotes.filter(name => tracking?.startsWith(`${name}/`)).sort((left, right) => right.length - left.length)[0];
        if (isRemote && !remote) throw new Error("The remote is no longer configured.");
        const branch = isRemote ? ref.slice(remote.length + 1) : ref;
        if ([remote, branch, snapshot.current].some(value => value?.startsWith("-"))) throw new Error("Unsupported branch or remote name.");
        return { ref, remote, branch, isRemote, tracking, current: snapshot.current,
            local: snapshot.local, upstreams: snapshot.upstreams };
    }

    run(id, ref, current, remote = true) {
        return this.controller.act(async () => {
            const action = this.actions.get(id);
            if (!action) throw new Error("This branch action is unavailable.");
            const context = await this.context(ref, current, remote);
            if (!["compare", "working-diff", "push"].includes(id)) await this.repository.assertNoOperation();
            if (["checkout-rebase", "rebase", "merge", "pull-rebase", "pull-merge"].includes(id) && !context.local.includes(current)) {
                throw new Error("Check out a local branch before using this action.");
            }
            await action(context);
        });
    }

    async checkout(context) {
        const { branch, ref, local, upstreams } = context;
        if (!context.isRemote) { await this.repository.run(["switch", branch]); return; }
        if (local.includes(branch)) {
            if (upstreams.get(branch) && upstreams.get(branch) !== ref) {
                throw new Error(`Local branch '${branch}' tracks another remote. Use New Branch to choose a different name.`);
            }
            await this.repository.run(["switch", branch]);
            return;
        }
        await this.repository.run(["switch", "--track", "-c", branch, ref]);
    }

    async rename(context) {
        if (context.isRemote) throw new Error("Rename is available for local branches only.");
        const name = await this.branchName(`Rename '${context.ref}'`, context.ref);
        if (name && name !== context.ref) await this.repository.run(["branch", "-m", context.ref, name]);
    }

    async delete(context) {
        if (context.isRemote) {
            if (isProtectedRemoteBranch(this.controller, context.ref, [context.remote])) throw new Error("This remote branch is protected by this repository's Git settings.");
            const ref = `refs/heads/${context.branch}`;
            const tip = (await this.repository.run(["ls-remote", "--heads", "--", context.remote, ref])).split(/\r?\n/).find(line => line.split("\t")[1] === ref)?.split("\t")[0];
            if (!tip) throw new Error("The remote branch no longer exists.");
            if (!await confirm(this.controller, "Delete remote branch", `Delete ${context.ref} from the remote? This affects other users of the repository.`, "Delete Remote Branch")) return;
            if (isProtectedRemoteBranch(this.controller, context.ref, [context.remote])) throw new Error("The branch protection rules changed. Deletion is no longer allowed.");
            await this.repository.run(["push", `--force-with-lease=${ref}:${tip}`, "--", context.remote, `:${ref}`]);
            return;
        }
        if (context.ref === context.current) throw new Error("Select a local branch other than the current branch.");
        if (await confirm(this.controller, "Delete branch", `Delete local branch '${context.ref}'?`, "Delete")) {
            await this.repository.run(["branch", "-d", context.ref]);
        }
    }

    async push(context) {
        this.controller.network("push", context.ref);
    }

    async update(context) {
        if (context.isRemote) { await this.repository.run(["fetch", "--", context.remote, context.branch]); return; }
        if (!context.tracking || !context.remote) throw new Error("This branch has no tracked remote branch.");
        if (context.ref === context.current) { this.controller.network("pull", context.ref); return; }
        const remoteBranch = context.tracking.slice(context.remote.length + 1);
        await this.repository.run(["fetch", "--", context.remote, `${remoteBranch}:${context.ref}`]);
    }

    async branchName(title, initial = "") {
        const name = await prompt(this.controller, title, "Branch name", initial);
        if (!name) return;
        if (name.startsWith("-")) throw new Error("Enter a valid branch name.");
        await this.repository.run(["check-ref-format", "--branch", name]);
        return name;
    }

    async newBranch(context) {
        const name = await this.branchName(`New Branch from '${context.ref}'`);
        if (name) await this.repository.run(["switch", "-c", name, context.ref]);
    }

    async compare(context) {
        this.controller.compare(context.current, context.ref);
    }

    async workingDiff(context) {
        this.controller.compare(context.ref);
    }

    async worktree(context) {
        const name = await this.branchName(`New Worktree from '${context.ref}'`, `${context.branch}-worktree`);
        if (!name) return;
        const suggested = join(dirname(this.repository.root), `${basename(this.repository.root)}-${name.replaceAll("/", "-")}`);
        const path = await prompt(this.controller, "New Worktree", "Worktree directory", suggested);
        if (!path) return;
        if (!isAbsolute(path)) throw new Error("Enter an absolute directory path.");
        await this.repository.run(["worktree", "add", "-b", name, path, context.ref]);
    }
}
