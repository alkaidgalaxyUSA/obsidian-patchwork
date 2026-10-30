import { basename, dirname, isAbsolute, join } from "node:path";
import { prompt, showOutput } from "./dialogs";

/** Remote branch operations share the controller's serialized mutation queue. */
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
            ["pull-rebase", context => this.repository.run(["pull", "--rebase", context.remote, context.branch])],
            ["pull-merge", context => this.repository.run(["pull", "--no-rebase", "--no-edit", context.remote, context.branch])],
        ]);
    }

    async context(ref, expectedCurrent) {
        const snapshot = await this.repository.snapshot();
        if (!snapshot.remote.includes(ref)) throw new Error("This remote branch no longer exists. Fetch and reopen the branch menu.");
        if (snapshot.current !== expectedCurrent) throw new Error("The current branch changed. Reopen the branch menu and try again.");
        const remote = snapshot.remotes.filter(name => ref.startsWith(`${name}/`)).sort((left, right) => right.length - left.length)[0];
        if (!remote) throw new Error("The remote is no longer configured.");
        const branch = ref.slice(remote.length + 1);
        if ([remote, branch, snapshot.current].some(value => value.startsWith("-"))) throw new Error("Unsupported branch or remote name.");
        return { ref, remote, branch, current: snapshot.current,
            local: snapshot.local, upstreams: snapshot.upstreams };
    }

    run(id, ref, current) {
        return this.controller.act(async () => {
            const action = this.actions.get(id);
            if (!action) throw new Error("This branch action is unavailable.");
            const context = await this.context(ref, current);
            if (["checkout-rebase", "rebase", "merge", "pull-rebase", "pull-merge"].includes(id) && !context.local.includes(current)) {
                throw new Error("Check out a local branch before using this action.");
            }
            await action(context);
        });
    }

    async checkout(context) {
        const { branch, ref, local, upstreams } = context;
        if (local.includes(branch)) {
            if (upstreams.get(branch) && upstreams.get(branch) !== ref) {
                throw new Error(`Local branch '${branch}' tracks another remote. Use New Branch to choose a different name.`);
            }
            await this.repository.run(["switch", branch]);
            return;
        }
        await this.repository.run(["switch", "--track", "-c", branch, ref]);
    }

    async branchName(title, initial = "") {
        const name = await prompt(this.app, title, "Branch name", initial);
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
        const commits = await this.repository.run(["log", "--left-right", "--oneline", `${context.current}...${context.ref}`, "--"]);
        const diff = await this.repository.run(["diff", "--no-ext-diff", "--no-textconv", "--no-color", context.current, context.ref, "--"]);
        showOutput(this.app, `Compare '${context.ref}' with '${context.current}'`,
            `Commits (< ${context.current}, > ${context.ref})\n${commits || "No different commits.\n"}\nChanges\n${diff || "No differences."}`);
    }

    async workingDiff(context) {
        const diff = await this.repository.run(["diff", "--no-ext-diff", "--no-textconv", "--no-color", context.ref, "--"]);
        showOutput(this.app, `Diff: '${context.ref}' with Working Tree`, diff);
    }

    async worktree(context) {
        const name = await this.branchName(`New Worktree from '${context.ref}'`, `${context.branch}-worktree`);
        if (!name) return;
        const suggested = join(dirname(this.repository.root), `${basename(this.repository.root)}-${name.replaceAll("/", "-")}`);
        const path = await prompt(this.app, "New Worktree", "Worktree directory", suggested);
        if (!path) return;
        if (!isAbsolute(path)) throw new Error("Enter an absolute directory path.");
        await this.repository.run(["worktree", "add", "-b", name, path, context.ref]);
    }
}
