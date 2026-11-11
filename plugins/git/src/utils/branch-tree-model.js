/** Shared branch tree primitives used by the header picker and history tree. */
export function branchLabel(ref, base = "", prefix = "") {
    return ref.slice(base.length + prefix.length);
}

export function branchFolder(label, groupByPrefix = true) {
    if (!groupByPrefix) return undefined;
    const slash = label.indexOf("/");
    return slash < 0 ? undefined : { name: label.slice(0, slash), rest: label.slice(slash + 1) };
}

export function groupRemoteBranches(branches, remotes) {
    return remotes.map(remote => ({ remote, refs: branches.filter(ref => ref.startsWith(`${remote}/`)) })).filter(group => group.refs.length);
}
