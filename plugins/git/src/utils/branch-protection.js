/** GitSharedSettings defaults; rules belong to the active repository. */
export function protectedBranchPatterns(controller) {
    const configured = controller.plugin.settingsStore.preferences.protectedBranchesByRoot?.[controller.repository.root];
    return Array.isArray(configured) ? configured : ["master", "main"];
}

export function isProtectedRemoteBranch(controller, ref, remotes) {
    const remote = [...remotes].sort((a, b) => b.length - a.length).find(name => ref?.startsWith(`${name}/`));
    if (!remote) return false;
    const branch = ref.slice(remote.length + 1);
    return protectedBranchPatterns(controller).some(pattern => {
        try { return new RegExp(`^(?:${pattern})$`).test(branch); }
        // Malformed persisted rules must not silently allow destructive actions.
        catch { return true; }
    });
}
