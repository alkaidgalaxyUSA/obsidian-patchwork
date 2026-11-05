import { copyFile, lstat, mkdtemp, open, readFile, realpath, rename, rm } from "node:fs/promises";
import { join } from "node:path";

const movedPath = (path, moves) => moves.reduce((current, move) => current === move.from || current.startsWith(move.from + "/")
    ? move.to + current.slice(move.from.length) : current, path);

/** Apply observed vault moves atomically, preserving every unrelated index entry. */
export async function updateMovedIndex(repo, moves, validate) {
    validate();
    await repo.assertNoOperation();
    const root = repo.root, indexPath = repo.indexPath;
    const beforeHead = await repo.head();
    const directory = await mkdtemp(join(repo.gitDir, "patchwork-move-"));
    const env = { GIT_INDEX_FILE: join(directory, "index") };
    const lockPath = indexPath + ".lock";
    let lock;
    try {
        lock = await open(lockPath, "wx");
        try { await copyFile(indexPath, env.GIT_INDEX_FILE); }
        catch (error) { if (error.code === "ENOENT") return []; throw error; }
        const run = args => { validate(); return repo.run(args, { cwd: root, env }); };
        const raw = await run(["ls-files", "--stage", "-z"]);
        const entries = raw.split("\0").filter(Boolean).map(record => {
            const tab = record.indexOf("\t"), [mode, , stage] = record.slice(0, tab).split(" ");
            return { path: record.slice(tab + 1), mode, stage };
        });
        const paths = new Set(entries.map(entry => entry.path));
        const changes = entries.map(entry => ({ ...entry, target: movedPath(entry.path, moves) })).filter(entry => entry.path !== entry.target);
        if (!changes.length) return [];
        for (const entry of changes) {
            if (entry.stage !== "0" || entry.mode === "160000") throw new Error("Resolve conflicts or move submodules with Git before synchronizing these paths.");
            if (paths.has(entry.target)) throw new Error("The move destination already exists in the Git index. Review and stage this move manually.");
            await lstat(join(root, entry.target));
            let oldExists = true;
            try { await lstat(join(root, entry.path)); }
            catch (error) { if (error.code !== "ENOENT") throw error; oldExists = false; }
            if (oldExists && (entry.path.toLowerCase() !== entry.target.toLowerCase()
                || await realpath(join(root, entry.path)) !== await realpath(join(root, entry.target)))) {
                throw new Error("The old path still exists. No Git index entries were changed.");
            }
        }
        // Removing first also handles case-only renames on case-insensitive filesystems.
        for (let offset = 0; offset < changes.length; offset += 100) {
            await run(["update-index", "--force-remove", "--", ...changes.slice(offset, offset + 100).map(entry => entry.path)]);
        }
        for (let offset = 0; offset < changes.length; offset += 100) {
            await run(["-c", "core.ignorecase=false", "add", "--all", "--", ...changes.slice(offset, offset + 100).map(entry => entry.target)]);
        }
        validate();
        if (repo.root !== root || repo.indexPath !== indexPath || await repo.head() !== beforeHead) throw new Error("The repository changed while synchronizing moved files.");
        await repo.assertNoOperation();
        const bytes = await readFile(env.GIT_INDEX_FILE);
        await lock.writeFile(bytes); await lock.sync();
        validate();
        await lock.close();
        await rename(lockPath, indexPath);
        lock = undefined;
        return changes.map(entry => ({ from: entry.path, to: entry.target }));
    } finally {
        if (lock) { await lock.close().catch(() => {}); await rm(lockPath, { force: true }); }
        await rm(directory, { recursive: true, force: true });
    }
}
