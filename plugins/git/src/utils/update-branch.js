import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { updateWorktree } from "./update-worktree.js";

/** Fetch on every invocation; cached incoming counts never gate an update. */
export async function updateCurrentBranch(repo, { branch, remote, target, strategy = "merge", saveChanges = true }) {
    await repo.assertNoOperation();
    if (await repo.branch() !== branch) throw new Error("The checked-out branch changed. Reopen Update.");
    const head = await repo.head();
    // Fetch the remote's configured refspecs, not only the current branch.
    await repo.run(["fetch", "--", remote]);
    const fetchPath = (await repo.run(["rev-parse", "--git-path", "FETCH_HEAD"])).trim();
    const fetchedRefs = await readFile(resolve(repo.root, fetchPath), "utf8");
    const fetched = fetchedRefs.split(/\r?\n/).map(line => line.split("\t"))
        .find(fields => fields[2]?.startsWith(`branch '${target}' of `))?.[0];
    // Never merge a stale remote-tracking ref if the branch was deleted or excluded.
    if (!fetched || !/^[0-9a-f]{40,64}$/.test(fetched)) throw new Error(`Remote branch '${remote}/${target}' was not fetched. Check that it exists and is included in the remote fetch configuration.`);
    if (await repo.branch() !== branch || await repo.head() !== head) throw new Error("The local branch changed during fetch. Reopen Update.");
    const ancestor = (await repo.run(["merge-base", head, fetched], { allowedExitCodes: [1] })).trim();
    if (!ancestor) throw new Error(`Cannot update ${branch} from ${remote}/${target}: no common history. Fetch completed; local commits and changes were not modified. Verify the remote or reconcile the histories separately.`);
    const incoming = Number((await repo.run(["rev-list", "--count", `${head}..${fetched}`])).trim());
    if (!incoming) return false;
    const args = strategy === "rebase" ? ["rebase", fetched] : ["merge", "--no-edit", fetched];
    await updateWorktree(repo, args, saveChanges);
    return true;
}

/** Upstream wins; an unambiguous same-name destination supports untracked branches. */
export function currentUpdateTarget(snapshot) {
    const branch = snapshot.current;
    if (!snapshot.local.includes(branch)) throw new Error("Check out a local branch before updating.");
    const tracking = snapshot.upstreams.get(branch);
    if (tracking) {
        const remote = snapshot.remotes.filter(name => tracking.startsWith(`${name}/`)).sort((a, b) => b.length - a.length)[0];
        return remote ? { branch, remote, target: tracking.slice(remote.length + 1) } : undefined;
    }
    const matches = snapshot.remotes.filter(remote => snapshot.remote.includes(`${remote}/${branch}`));
    const remote = matches.length === 1 ? matches[0] : snapshot.remotes.length === 1 ? snapshot.remotes[0] : undefined;
    return remote ? { branch, remote, target: branch } : undefined;
}
