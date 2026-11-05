import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";

/** Inspect worktree paths using a disposable index; never stage the user's files. */
export async function withWorktreeIndex(repo, paths, action) {
    const directory = await mkdtemp(join(repo.gitDir, "patchwork-status-"));
    const env = { GIT_INDEX_FILE: join(directory, "index") };
    try {
        await copyFile(repo.indexPath, env.GIT_INDEX_FILE);
        const baseline = (await repo.run(["write-tree"], { env })).trim();
        for (let offset = 0; offset < paths.length; offset += 100) {
            await repo.run(["add", "--all", "--", ...paths.slice(offset, offset + 100)], { env });
        }
        return await action(env, baseline);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
}

export async function detectWorktreeRenames(repo, entries) {
    if (entries.some(entry => entry.conflict)) return entries;
    const deleted = new Map(entries.filter(entry => entry.code[1] === "D" && !entry.original).map(entry => [entry.path, entry]));
    const added = new Map(entries.filter(entry => entry.untracked && !entry.path.endsWith("/")).map(entry => [entry.path, entry]));
    if (!deleted.size || !added.size) return entries;
    const raw = await withWorktreeIndex(repo, [...deleted.keys(), ...added.keys()], (env, baseline) =>
        repo.run(["diff", "--cached", "--name-status", "-z", "--find-renames", "--diff-filter=R", baseline], { env }));
    const parts = raw.split("\0"), replacements = new Map(), removed = new Set();
    for (let index = 0; index < parts.length && parts[index]; index += 3) {
        const original = parts[index + 1], path = parts[index + 2];
        const source = deleted.get(original), target = added.get(path);
        if (!source || !target) continue;
        replacements.set(path, { ...target, original, code: source.code[0] + "R", staged: source.staged, untracked: false, worktreeRename: true });
        removed.add(original);
    }
    return entries.filter(entry => !removed.has(entry.path)).map(entry => replacements.get(entry.path) || entry);
}
