import { getServiceRegistry } from "../../../utils/service-registry";

/** Paint only Project rows from Git's vault-relative semantic snapshots. */
export class ExplorerStatus {
    constructor(plugin) {
        this.roots = new Map(); this.status = new Map();
        this.stop = getServiceRegistry(plugin.app).watch("project", "git", git => {
            this.stopSnapshots?.(); this.status.clear();
            this.stopSnapshots = git?.onSnapshot(snapshot => {
                this.status = new Map((snapshot.ready ? snapshot.status : []).map(entry => [this.key(entry.vaultPath), entry.state]));
                for (const root of this.roots.keys()) this.paint(root);
            });
            for (const root of this.roots.keys()) this.paint(root);
        });
    }
    key(path) { return process.platform === "win32" ? path.toLowerCase() : path; }
    add(root) {
        const observer = new root.ownerDocument.defaultView.MutationObserver(() => this.paint(root));
        this.roots.set(root, { observer, rows: new Map() });
        observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-path"] });
        this.paint(root);
    }
    release(row, lease) {
        if (row.getAttribute("data-pw-git-status") !== lease.applied) return;
        if (lease.previous === null) row.removeAttribute("data-pw-git-status"); else row.setAttribute("data-pw-git-status", lease.previous);
    }
    paint(root) {
        const record = this.roots.get(root); if (!record) return;
        const stateFor = row => this.status.get(this.key(row.dataset.path));
        const rows = new Set(root.querySelectorAll(".nav-file-title[data-path]"));
        for (const [row, lease] of record.rows) if (!rows.has(row) || !stateFor(row)) {
            this.release(row, lease); record.rows.delete(row);
        }
        for (const row of rows) {
            const state = stateFor(row); if (!state) continue;
            const lease = record.rows.get(row) ?? { previous: row.getAttribute("data-pw-git-status") };
            lease.applied = state; record.rows.set(row, lease);
            if (row.getAttribute("data-pw-git-status") !== state) row.setAttribute("data-pw-git-status", state);
        }
    }
    remove(root) {
        const record = this.roots.get(root); if (!record) return;
        record.observer.disconnect();
        for (const [row, lease] of record.rows) this.release(row, lease);
        this.roots.delete(root);
    }
    dispose() { this.stop(); this.stopSnapshots?.(); for (const root of this.roots.keys()) this.remove(root); this.status.clear(); }
}
