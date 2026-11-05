/** Keep an identifiable stash until both update and indexed restoration succeed. */
export async function updateWorktree(repo, args, saveChanges) {
    await repo.assertNoOperation();
    const branch = await repo.branch();
    const entries = await repo.status();
    if (entries.some(entry => entry.conflict)) throw new Error("Resolve conflicts before updating.");
    if (entries.length && !saveChanges) throw new Error("Enable saving local changes, or commit/stash them before updating.");
    let saved;
    if (entries.length) {
        const before = await repo.run(["rev-parse", "--verify", "refs/stash"]).catch(() => "");
        // Stash internally builds :(literal) pathspecs for clean; forcing literal
        // pathspecs again leaves the saved untracked files behind on Git for Windows.
        await repo.run(["stash", "push", "--include-untracked", "--message", `Patchwork update ${new Date().toISOString()}`], { env: { GIT_LITERAL_PATHSPECS: "0" } });
        saved = (await repo.run(["rev-parse", "--verify", "refs/stash"])).trim();
        if (!saved || saved === before.trim()) throw new Error("Local changes were not saved. Update cancelled.");
        if ((await repo.status()).length) throw new Error(`Some local changes could not be saved. Update cancelled; saved changes remain in stash ${saved}.`);
    }
    let updateError;
    try {
        if (await repo.branch() !== branch) throw new Error("The checked-out branch changed before updating.");
        await repo.run(args);
    }
    catch (error) {
        if (!saved) throw error;
        try { await repo.assertNoOperation(); }
        catch { throw new Error(`${error.message}\nLocal changes are preserved in stash ${saved}. Finish or abort the update, then restore this stash with its index from Stashes and Shelves.`); }
        updateError = error;
    }
    if (!saved) return;
    if (await repo.branch() !== branch) throw new Error(`The checked-out branch changed. Local changes remain in stash ${saved}; restore them on the original branch.`);
    try { await repo.run(["stash", "apply", "--index", saved]); }
    catch (error) { throw new Error(`${updateError ? "Update failed" : "Update completed"}, but local changes need recovery: ${error.message}\nSaved changes remain in stash ${saved}. Resolve conflicts before restoring again.`); }
    // A concurrent external stash must never be dropped in place of our own.
    const list = await repo.run(["stash", "list", "--format=%H%x09%gd"]);
    const reference = list.split(/\r?\n/).map(line => line.split("\t")).find(([hash]) => hash === saved)?.[1];
    if (reference) {
        const actual = (await repo.run(["rev-parse", "--verify", reference])).trim();
        if (actual === saved) await repo.run(["stash", "drop", reference]);
    }
    if (updateError) throw new Error(`${updateError.message}\nLocal changes and staged state have been restored.`);
}
