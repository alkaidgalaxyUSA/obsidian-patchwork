import { getServiceRegistry } from "../../../utils/service-registry";

/** Document tabs consume file status only; editor text never participates. */
export function installDocumentTabGitStatus(plugin) {
    const { app } = plugin;
    const leases = new Map();
    const attribute = "data-pw-tab-git-status";
    const key = path => process.platform === "win32" ? path.toLowerCase() : path;
    let modified = new Set();
    let unsubscribe;
    let disposed = false;
    const release = (header, previous) => {
        if (header.getAttribute(attribute) !== "modified") return;
        if (previous === null) header.removeAttribute(attribute);
        else header.setAttribute(attribute, previous);
    };
    const paint = () => {
        if (disposed) return;
        const current = new Set();
        app.workspace.iterateAllLeaves(leaf => {
            const header = leaf.tabHeaderEl;
            const path = leaf.view.file?.path ?? leaf.getViewState().state?.file;
            if (!header?.isConnected || !header.closest(".mod-root") || typeof path !== "string"
                || !modified.has(key(path))) return;
            current.add(header);
            if (!leases.has(header)) leases.set(header, header.getAttribute(attribute));
            if (header.getAttribute(attribute) !== "modified") header.setAttribute(attribute, "modified");
        });
        for (const [header, previous] of leases) {
            if (current.has(header)) continue;
            release(header, previous);
            leases.delete(header);
        }
    };
    const update = snapshot => {
        modified = new Set((snapshot.ready ? snapshot.status : [])
            .filter(entry => entry.state === "modified").map(entry => key(entry.vaultPath)));
        paint();
    };
    const stop = getServiceRegistry(app).watch("content", "git", api => {
        unsubscribe?.();
        unsubscribe = undefined;
        modified.clear();
        if (api) {
            update(api.getSnapshot());
            unsubscribe = api.onSnapshot(update);
        }
        paint();
    });
    for (const event of ["layout-change", "active-leaf-change", "file-open", "window-open"]) {
        plugin.registerEvent(app.workspace.on(event, paint));
    }
    for (const event of ["rename", "delete"]) plugin.registerEvent(app.vault.on(event, paint));
    app.workspace.onLayoutReady(paint);
    plugin.register(() => {
        disposed = true;
        stop();
        unsubscribe?.();
        for (const [header, previous] of leases) release(header, previous);
        leases.clear();
        modified.clear();
    });
}
