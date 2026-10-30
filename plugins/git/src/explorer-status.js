import { fileStatus } from "./utils/file-status.js";

/** Keep Project filenames in sync with the same status snapshot as Commit. */
export class ExplorerStatus {
    constructor(app, repository) {
        this.app = app;
        this.repository = repository;
        this.status = new Map();
        this.roots = new Map();
    }

    key(path) { return process.platform === "win32" ? path.toLowerCase() : path; }

    update(entries, ignored = []) {
        this.status = new Map([...ignored, ...entries].map(entry => [this.key(entry.path), fileStatus(entry)]));
        this.sync();
    }

    sync() {
        if (this.disposed) return;
        const roots = new Set(this.app.workspace.getLeavesOfType("file-explorer").map(leaf => leaf.view.containerEl));
        for (const [root, observer] of this.roots) {
            if (roots.has(root)) continue;
            observer.disconnect(); this.clear(root); this.roots.delete(root);
        }
        for (const root of roots) {
            if (!this.roots.has(root)) {
                const observer = new root.ownerDocument.defaultView.MutationObserver(() => this.paint(root));
                observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-path"] });
                this.roots.set(root, observer);
            }
            this.paint(root);
        }
    }

    paint(root) {
        for (const row of root.querySelectorAll(".nav-file-title[data-path]")) {
            let state;
            try { state = this.status.get(this.key(this.repository.path(row.dataset.path))); }
            catch { /* A vault can contain files outside the discovered repository. */ }
            if (state) row.setAttribute("data-pw-git-status", state);
            else row.removeAttribute("data-pw-git-status");
        }
    }

    clear(root) {
        for (const row of root.querySelectorAll("[data-pw-git-status]")) row.removeAttribute("data-pw-git-status");
    }

    dispose() {
        this.disposed = true;
        for (const [root, observer] of this.roots) { observer.disconnect(); this.clear(root); }
        this.roots.clear();
    }
}
