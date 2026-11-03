import { isAbsolute } from "node:path";
import { GitTaskModal } from "./ui/task-modal";

export class GitCloneModal extends GitTaskModal {
    constructor(controller) { super(controller, "Clone Repository"); }
    onOpen() {
        super.onOpen();
        this.url = this.field("Repository URL");
        this.directory = this.field("New absolute directory");
        this.branch = this.field("Branch or tag (optional)");
        this.depth = this.field("History depth (empty for full)");
        this.submodules = this.field("Submodules", "no", [["no", "Do not initialize"], ["yes", "Initialize recursively"]]);
        this.body.createDiv({ cls: "pw-git-task-help", text: "Clone uses your configured Git authentication. Cancel stops Git; inspect the destination before retrying. The active vault is not switched." });
        this.canCancelPending = true;
        this.cloneButton = this.button("Clone", () => this.clone(), true);
        this.url.oninput = this.directory.oninput = this.depth.oninput = () => this.updateActions();
        this.updateActions();
    }
    cancel() { this.cancellation?.abort(); if (!this.pending) this.close(); }
    updateActions() {
        const depth = this.depth.value.trim();
        const reason = !this.url.value.trim() ? "Enter a repository URL."
            : !isAbsolute(this.directory.value.trim()) ? "Enter an absolute destination directory."
            : depth && (!/^[1-9]\d*$/.test(depth) || !Number.isSafeInteger(Number(depth))) ? "History depth must be a positive integer." : "";
        this.cloneButton.disabled = this.pending || !!reason;
        this.cloneButton.title = reason;
    }
    async clone() {
        const url = this.url.value.trim(), directory = this.directory.value.trim(), branch = this.branch.value.trim(), depth = this.depth.value.trim();
        if (!url || !isAbsolute(directory)) throw new Error("Enter a repository URL and an absolute destination.");
        if (depth && (!/^[1-9]\d*$/.test(depth) || !Number.isSafeInteger(Number(depth)))) throw new Error("History depth must be a positive integer.");
        this.cancellation = new AbortController();
        this.status.setText("Cloning… Cancel remains available. Large repositories may take several minutes.");
        try {
            await this.change(() => this.repo.run(["clone", ...(branch ? ["--branch", branch] : []), ...(depth ? ["--depth", depth] : []), ...(this.submodules.value === "yes" ? ["--recurse-submodules"] : []), "--", url, directory], { signal: this.cancellation.signal, timeout: 600000 }));
            this.status.setText(`Repository cloned to ${directory}`);
        } finally { this.cancellation = undefined; }
    }
    onClose() { this.cancellation?.abort(); super.onClose(); }
}
