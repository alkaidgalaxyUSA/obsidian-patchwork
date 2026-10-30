/** Resolve the filename color independently of staging. */
export function fileStatus(entry) {
    if (entry.conflict) return "conflict";
    if (entry.ignored) return "ignored";
    if (entry.untracked) return "unversioned";
    if (entry.code.includes("D")) return "deleted";
    if (entry.code.includes("A")) return "added";
    return "modified";
}
