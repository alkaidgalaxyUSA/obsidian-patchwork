/** Count committed changes, not selected rows or rename pathspecs. */
export async function commitResult(repo, before, amend, result) {
    try {
        const hash = await repo.head();
        if (!hash || hash === before) throw new Error("The resulting commit could not be identified.");
        const message = (await repo.run(["show", "-s", "--format=%B", hash])).trimEnd();
        const args = before && amend ? ["diff", before, hash] : ["diff-tree", "--root", "--no-commit-id", "-r", hash];
        const records = (await repo.run([...args, "--name-status", "-M", "-z", "--"])).split("\0");
        let count = 0;
        for (let i = 0; i < records.length && records[i]; count++) i += /^[RC]/.test(records[i]) ? 3 : 2;
        return { ...result, root: repo.root, hash, message, count };
    } catch (error) {
        return { ...result, warning: [result.warning, `Commit created, but its details could not be refreshed: ${error.message}`].filter(Boolean).join("\n") };
    }
}
