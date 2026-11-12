import { Notice } from "obsidian";

/** Private header actions use this plugin's controller and its existing mutation queue. */
export class GitHeaderActions {
    constructor(controller, document) { this.controller = controller; this.document = document; }
    get ready() { return this.controller.ready && !this.controller.disposed; }
    get busy() { return this.controller.busy; }
    get repositoryMissing() { return /not a git repository/i.test(this.controller.error ?? ""); }

    async snapshot() {
        await this.controller.refresh();
        if (!this.ready) throw new Error(this.controller.error || "Git is not ready.");
        return this.controller.repository.snapshot();
    }

    command(id) {
        if (this.controller.disposed) return;
        if (["open-commit", "create-branch", "init-repo"].includes(id) && !this.mainWindow()) return;
        const actions = {
            pull: () => this.controller.network("pull", undefined, undefined, this.document),
            "open-commit": () => this.controller.open(),
            push: () => this.controller.network("push"),
            "create-branch": () => this.controller.newBranch(),
            "init-repo": () => this.controller.initialize(),
        };
        void Promise.resolve().then(() => {
            if (!this.controller.disposed) return actions[id]?.();
        }).catch(error => new Notice(error.message));
    }

    fetch() { return this.ready ? this.controller.network("fetch", undefined, undefined, this.document) : Promise.reject(new Error("Git is not ready.")); }
    mainWindow() {
        if (this.document === this.controller.app.workspace.containerEl.ownerDocument) return true;
        new Notice("This Git action is unavailable in this window."); return false;
    }
    remoteAction(id, ref, current) { if (this.ready && this.mainWindow()) return this.controller.branchActions.run(id, ref, current); }
    checkout(ref, remote = false) { if (this.ready) return this.controller.checkout(ref, remote); }
}
