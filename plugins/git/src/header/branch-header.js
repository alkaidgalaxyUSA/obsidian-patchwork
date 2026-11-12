import { GitPopup } from "./git-popup";
import { setIcon } from "../utils/icons";
import { scopeModule } from "../../../utils/module-scope";
import { renderBranchSync } from "../ui/branch-sync";

/** Git renders branch state only inside its granted Borders header slot. */
export class BranchHeader {
    constructor(controller, host, context) {
        this.controller = controller; this.doc = context.document;
        this.button = host.createEl("button", { cls: "pw-vault-git", attr: { type: "button", "aria-haspopup": "menu", "aria-expanded": "false", "data-tooltip-position": "bottom" } });
        this.scope = scopeModule(this.button, "git", { contribution: true, surface: "header" });
        this.button.setAttribute("data-tooltip-delay", "0");
        setIcon(this.button.createSpan(), "git-branch-flipped");
        this.label = this.button.createSpan({ cls: "pw-vault-git-label" });
        this.sync = this.button.createSpan({ cls: "pw-git-branch-sync" });
        setIcon(this.button.createSpan({ cls: "pw-header-chevron" }), "chevron-down");
        this.button.addEventListener("click", () => {
            if (this.menu) { this.menu.close(); return; }
            if (this.disposed || controller.disposed) return;
            this.menu = new GitPopup(controller, this.button, () => { this.menu = undefined; }); this.menu.open();
        });
        this.stop = controller.snapshots.subscribe(snapshot => this.refresh(snapshot));
    }

    refresh(snapshot) {
        if (this.disposed) return;
        const branch = snapshot.ready ? snapshot.branch || (snapshot.detachedCommit ? `Detached ${snapshot.detachedCommit}` : "Detached HEAD") : "Git";
        if (this.label.textContent !== branch) this.label.textContent = branch;
        renderBranchSync(this.sync, snapshot.sync);
        this.button.title = snapshot.error || `Git: ${branch}`;
        this.button.setAttribute("aria-label", snapshot.error || `Git: ${branch}`);
        void this.menu?.load();
    }

    dispose() { this.disposed = true; this.menu?.close(false); this.stop(); this.scope.dispose(); this.button.remove(); }
}
