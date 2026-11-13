/** Reconcile stat-only modifications without changing the user's index. */
export async function reconcileWorktreeStatus(repo, entries) {
    const needsContentCheck = entry => !entry.conflict && entry.code[1] === "M";
    if (!entries.some(needsContentCheck)) return entries;
    // status can retain an M after a rewrite whose clean-filtered content is
    // unchanged, especially when optional index refreshes are disabled.
    const raw = await repo.run(["diff", "--name-only", "-z", "--no-renames", "--no-ext-diff", "--no-textconv", "--ignore-submodules=none"]);
    const changed = new Set(raw.split("\0").filter(Boolean));
    return entries.flatMap(entry => {
        if (!needsContentCheck(entry) || changed.has(entry.path)) return [entry];
        if (!entry.staged) return [];
        return [{ ...entry, code: entry.code[0] + " " }];
    });
}
