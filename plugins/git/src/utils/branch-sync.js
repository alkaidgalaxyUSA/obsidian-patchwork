/** Compare immutable local and remote tips without fetching or changing upstream configuration. */
export async function readBranchSync(repository, refs, remotes) {
    const rows = refs.trim().split(/\r?\n/).filter(Boolean).map(line => line.split("\t"));
    const tips = new Map(rows.map(([ref, hash]) => [ref, hash]));
    const previous = repository.branchSyncCache ?? new Map();
    const cache = new Map();
    const result = new Map();
    for (const [ref, hash, upstream] of rows) {
        if (!ref.startsWith("refs/heads/")) continue;
        const branch = ref.slice("refs/heads/".length);
        const candidates = remotes.map(remote => `refs/remotes/${remote}/${branch}`).filter(target => tips.has(target));
        const target = upstream || (candidates.length === 1 ? candidates[0] : undefined);
        const targetHash = tips.get(target);
        const key = JSON.stringify([hash, target, targetHash, upstream, remotes]);
        let state = previous.get(ref)?.key === key ? previous.get(ref).state : undefined;
        if (!state) {
            const comparison = target?.replace(/^refs\/(heads|remotes)\//, "");
            state = { tracking: !!upstream, comparison, status: "unavailable" };
            if (!target && remotes.length === 1) state.status = "unpublished";
            else if (targetHash) {
                try {
                    const counts = (await repository.run(["rev-list", "--left-right", "--count", `${hash}...${targetHash}`])).trim().split(/\s+/).map(Number);
                    if (counts.length !== 2 || counts.some(count => !Number.isSafeInteger(count) || count < 0)) throw new Error("Invalid branch comparison.");
                    state = { ...state, status: "compared", ahead: counts[0], behind: counts[1] };
                } catch { /* Keep unavailable comparisons distinct from synchronized branches. */ }
            }
        }
        if (state.status !== "unavailable") cache.set(ref, { key, state });
        result.set(branch, state);
    }
    repository.branchSyncCache = cache;
    return result;
}
