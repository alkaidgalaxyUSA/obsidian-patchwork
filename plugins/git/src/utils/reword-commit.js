import { isProtectedRemoteBranch } from "./branch-protection";

export async function validateReword(controller, root, hash, branch) {
    const repo = controller.repository;
    if (controller.disposed || repo.root !== root || await repo.head() !== hash || await repo.branch() !== branch) {
        throw new Error("The repository or HEAD changed. Reopen Edit Commit Message.");
    }
    await repo.assertNoOperation();
    const snapshot = await repo.snapshot();
    const containing = (await repo.run(["for-each-ref", `--contains=${hash}`, "--format=%(refname:short)", "refs/remotes"])).trim().split("\n");
    if (containing.some(ref => isProtectedRemoteBranch(controller, ref, snapshot.remotes))) {
        throw new Error("This commit is already on a protected remote branch and cannot be rewritten.");
    }
}

export async function rewordCommit(controller, record, message) {
    const repo = controller.repository;
    if (!message.trim()) throw new Error("Enter a commit message.");
    await validateReword(controller, record.root, record.hash, record.branch);
    await repo.run(["commit", "--amend", "--only", "--no-verify", "-m", message]);
    return { ...record, previous: record.hash, hash: await repo.head(), message, count: undefined };
}

export async function undoReword(controller, record) {
    const repo = controller.repository;
    await validateReword(controller, record.root, record.hash, record.branch);
    const trees = await Promise.all([record.hash, record.previous].map(hash => repo.run(["rev-parse", `${hash}^{tree}`])));
    if (trees[0] !== trees[1]) throw new Error("The commit contents changed. Automatic message undo is unavailable.");
    // Compare-and-swap only the ref. The identical trees need no index/worktree reset.
    await repo.run(["update-ref", "-m", "Undo commit message edit", "HEAD", record.previous, record.hash]);
}
