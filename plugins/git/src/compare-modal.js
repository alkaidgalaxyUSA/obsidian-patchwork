import { GitTaskModal } from "./ui/task-modal";
import { renderDiff } from "./history/utils/render-diff";

/** Two immutable revisions, their exclusive commits and per-file differences. */
export class GitCompareModal extends GitTaskModal {
    constructor(controller, left = "HEAD", right = "", paths = []) { super(controller, "Compare Revisions"); this.leftRef = left; this.rightRef = right; this.paths = paths; }
    onOpen() {
        super.onOpen(); this.modalEl.classList.add("pw-git-compare-modal");
        this.left = this.field("From", this.leftRef);
        this.right = this.field("To", this.rightRef);
        this.body.createDiv({ cls: "pw-git-task-help", text: "Leave To empty to compare with the working tree. The diff shows how From becomes To." });
        this.commits = this.body.createDiv({ cls: "pw-git-compare-commits" });
        const content = this.body.createDiv({ cls: "pw-git-compare-content" });
        this.files = content.createDiv({ cls: "pw-git-compare-files", attr: { role: "navigation", "aria-label": "Changed files" } });
        this.output = content.createEl("pre", { cls: "pw-git-output" });
        this.button("Compare", () => this.load(), true);
        this.openButton = this.button("Open Diff Tab", () => this.controller.openDiffText(this.raw, "Revision comparison", this.context.document));
        this.left.oninput = this.right.oninput = () => {
            this.loadedInputs = undefined;
            this.status.setText("Revisions changed. Compare again to update the result.");
            this.updateActions();
        };
        this.updateActions();
        void this.perform(() => this.load());
    }
    updateActions() {
        const current = this.loadedInputs?.[0] === this.left.value.trim() && this.loadedInputs?.[1] === this.right.value.trim();
        this.openButton.disabled = this.pending || !current || !this.raw;
        this.openButton.title = !current ? "Compare these revisions before opening the diff." : !this.raw ? "No differences to open." : "";
    }
    async revision(value) { return (await this.repo.run(["rev-parse", "--verify", "--end-of-options", `${value}^{commit}`])).trim(); }
    async load() {
        this.loadedInputs = undefined;
        this.raw = undefined;
        this.commits.empty(); this.files.empty(); this.output.empty();
        this.updateActions();
        const inputs = [this.left.value.trim(), this.right.value.trim()];
        const left = await this.revision(this.left.value.trim() || "HEAD");
        const right = this.right.value.trim() ? await this.revision(this.right.value.trim()) : undefined;
        const git = this.controller.plugin.history.git;
        const raw = await git.diffCommit(left, right, this.paths);
        const files = await git.parseDiff(raw);
        const logs = right ? await Promise.all([this.repo.run(["log", "-100", "--format=%h %s", `${right}..${left}`, "--", ...this.paths]), this.repo.run(["log", "-100", "--format=%h %s", `${left}..${right}`, "--", ...this.paths])]) : [];
        this.validate(); this.raw = raw; this.loadedInputs = inputs;
        this.commits.empty(); this.files.empty(); this.output.empty();
        for (let index = 0; index < logs.length; index++) {
            const column = this.commits.createDiv();
            column.createEl("strong", { text: index === 0 ? "Only in From" : "Only in To" });
            column.createEl("pre", { cls: "pw-git-task-list", text: logs[index] || "No exclusive commits." });
        }
        for (const file of files) {
            const button = this.files.createEl("button", { text: `${file.path}  +${file.additions} −${file.deletions}`, attr: { type: "button", title: file.path } });
            button.setAttribute("aria-pressed", String(file === files[0]));
            button.onclick = () => {
                for (const item of this.files.children) item.setAttribute("aria-pressed", String(item === button));
                this.output.empty(); renderDiff(this.output, raw, [file], "split", () => {});
            };
        }
        if (files[0]) renderDiff(this.output, raw, [files[0]], "split", () => {});
        else this.output.setText("No differences.");
        this.status.setText(`${files.length} changed files${right ? "" : " · working tree snapshot; compare again after editing"}`);
    }
}
