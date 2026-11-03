import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { GitTaskModal } from "./ui/task-modal";
import { confirm } from "./dialogs";
import { setIcon } from "./utils/icons";

const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";

/** Build Git's native interactive todo; native continuation handles conflicts. */
export class GitRebaseModal extends GitTaskModal {
    constructor(controller, base = "HEAD~1") { super(controller, "Interactive Rebase"); this.base = base; }
    onOpen() {
        super.onOpen();
        this.upstream = this.field("Rebase commits after (or ROOT)", this.base);
        this.body.createDiv({ cls: "pw-git-task-help", text: "Commits are ordered oldest first. Select a commit to change its action or position. A backup reference is created before rewriting." });
        const toolbar = this.body.createDiv({ cls: "pw-git-rebase-toolbar", attr: { role: "group", "aria-label": "Commit actions" } });
        this.moveButtons = [-1, 1].map(delta => {
            const title = delta < 0 ? "Move commit earlier" : "Move commit later";
            const button = toolbar.createEl("button", { cls: "clickable-icon", attr: { type: "button", title, "aria-label": title } });
            setIcon(button, `idea/expui/general/${delta < 0 ? "moveUp" : "moveDown"}_dark.svg`);
            button.onclick = () => this.move(delta);
            this.controls.push(button); return button;
        });
        this.action = toolbar.createEl("select", { attr: { "aria-label": "Selected commit action" } });
        for (const name of ["pick", "reword", "edit", "squash", "fixup", "drop"]) this.action.createEl("option", { value: name, text: name === "edit" ? "Stop to Edit" : name[0].toUpperCase() + name.slice(1) });
        this.controls.push(this.action);
        this.action.onchange = () => {
            if (this.pending || !this.selected) return;
            this.selected.action = this.action.value;
            this.render();
            if (this.selected.action === "reword") this.message.focus();
        };
        this.list = this.body.createDiv({ cls: "pw-git-rebase-list" });
        const messageLabel = this.body.createEl("label", { cls: "pw-git-rebase-message" });
        messageLabel.createSpan({ text: "Commit message (editable for Reword)" });
        this.message = messageLabel.createEl("textarea", { attr: { "aria-label": "Commit message", spellcheck: "false", rows: "4" } });
        this.controls.push(this.message);
        this.message.oninput = () => {
            if (!this.pending && this.selected?.action === "reword") {
                this.selected.message = this.message.value; this.updateActions();
            }
        };
        this.button("Load Commits", () => this.load());
        this.startButton = this.button("Start Rebase…", () => this.start(), true);
        this.upstream.oninput = () => this.updateActions();
        this.updateActions();
        void this.perform(() => this.load());
    }
    updateActions() {
        if (!this.startButton) return;
        const first = this.rows?.find(row => row.action !== "drop");
        const reason = !this.rows?.length || this.loadedBase !== this.upstream.value.trim() ? "Load a valid, nonempty commit range before starting rebase."
            : !this.clean ? "Commit or stash local changes, then reload the commits."
            : this.controller.operation ? "Finish or abort the active Git operation first."
            : first && ["squash", "fixup"].includes(first.action) ? "The first retained commit must be Pick or Reword."
            : this.rows.some(row => row.action === "reword" && !row.message.trim()) ? "Enter a message for every Reword commit." : "";
        this.startButton.disabled = this.pending || !!reason;
        this.startButton.title = reason;
        const index = this.rows?.indexOf(this.selected) ?? -1;
        this.action.disabled = this.pending || index < 0;
        this.message.disabled = this.pending || index < 0;
        this.message.readOnly = this.selected?.action !== "reword";
        this.moveButtons.forEach((button, direction) => {
            button.disabled = this.pending || index < 0 || (direction === 0 ? index === 0 : index === this.rows.length - 1);
        });
        for (const button of this.list.querySelectorAll("button")) button.disabled = this.pending;
    }
    async load() {
        this.rows = [];
        this.clean = false;
        this.selected = undefined;
        this.message.value = "";
        this.list.empty();
        this.updateActions();
        this.head = await this.repo.head();
        this.branch = await this.repo.branch();
        this.loadedBase = this.upstream.value.trim();
        this.baseHash = this.loadedBase === "ROOT" ? undefined : (await this.repo.run(["rev-parse", "--verify", "--end-of-options", `${this.loadedBase}^{commit}`])).trim();
        if (!this.head || this.branch.startsWith("Detached ")) throw new Error("Check out a local branch with commits.");
        if (this.baseHash) await this.repo.run(["merge-base", "--is-ancestor", this.baseHash, this.head]);
        const range = this.baseHash ? `${this.baseHash}..${this.head}` : this.head;
        if ((await this.repo.run(["rev-list", "--merges", range])).trim()) throw new Error("This range contains merge commits. Select a linear range; merge-preserving rebases must be performed in Git.");
        const raw = await this.repo.run(["log", "--reverse", "--format=%H%x00%s%x00%B%x00", range]);
        const parts = raw.split("\0"); this.rows = [];
        for (let index = 0; index + 2 < parts.length; index += 3) {
            const hash = parts[index].trim(); if (hash) this.rows.push({ hash, subject: parts[index + 1], action: "pick", message: parts[index + 2] });
        }
        this.clean = !(await this.repo.status()).length;
        this.validate(); this.render(); this.status.setText(this.clean ? `${this.rows.length} commits to review` : "Commit or stash local changes, then reload the commits.");
    }
    render() {
        this.list.empty();
        if (!this.rows.includes(this.selected)) this.selected = this.rows[0];
        const table = this.list.createEl("table");
        const header = table.createEl("thead").createEl("tr");
        for (const text of ["Commit", "Action", "Subject"]) header.createEl("th", { text, attr: { scope: "col" } });
        const body = table.createEl("tbody");
        this.rows.forEach(commit => {
            const row = body.createEl("tr", { cls: commit === this.selected ? "is-selected" : "" });
            row.createEl("td", { text: commit.hash.slice(0, 8), attr: { title: commit.hash } });
            row.createEl("td", { text: commit.action });
            const button = row.createEl("td").createEl("button", { text: commit.subject, attr: { type: "button", "aria-pressed": String(commit === this.selected) } });
            row.onclick = () => { if (!this.pending) { this.selected = commit; this.render(); this.list.querySelector(".is-selected button")?.focus(); } };
        });
        this.action.value = this.selected?.action ?? "pick";
        this.message.value = this.selected?.message ?? "";
        this.updateActions();
    }
    move(delta) {
        const index = this.rows?.indexOf(this.selected) ?? -1;
        if (this.pending || index < 0 || index + delta < 0 || index + delta >= this.rows.length) return;
        [this.rows[index], this.rows[index + delta]] = [this.rows[index + delta], this.rows[index]];
        this.render();
        this.list.querySelector(".is-selected")?.scrollIntoView({ block: "nearest" });
    }
    async start() {
        if (!this.rows?.length || this.upstream.value.trim() !== this.loadedBase) throw new Error("Load the commits first.");
        const rows = this.rows.map(row => ({ ...row }));
        const first = rows.find(row => row.action !== "drop");
        if (first && ["squash", "fixup"].includes(first.action)) throw new Error("The first retained commit must be Pick or Reword.");
        if (rows.some(row => row.action === "reword" && !row.message.trim())) throw new Error("Enter a message for every Reword commit.");
        if (!await confirm(this.controller, "Rewrite branch history", `Rewrite ${rows.length} commits on ${this.branch}? Already-pushed commits will have new hashes. A backup ref will retain the original history.`, "Start Rebase")) return;
        await this.change(async () => {
            await this.repo.assertNoOperation();
            if (await this.repo.head() !== this.head || await this.repo.branch() !== this.branch) throw new Error("The branch changed. Reload commits.");
            if ((await this.repo.status()).length) throw new Error("Commit or stash all changes before rebasing.");
            const id = randomUUID(), directory = join(this.repo.gitDir, "patchwork-rebase", id);
            await mkdir(directory, { recursive: true });
            const lines = [];
            for (let index = 0; index < rows.length; index++) {
                const row = rows[index];
                lines.push(`${row.action === "reword" ? "pick" : row.action} ${row.hash}`);
                if (row.action === "reword") {
                    const path = join(directory, `${index}.message`);
                    await writeFile(path, row.message, { flag: "wx" });
                    lines.push(`exec git commit --amend --file ${quote(path.replaceAll("\\", "/"))}`);
                }
            }
            const todo = join(directory, "todo"); await writeFile(todo, lines.join("\n") + "\n", { flag: "wx" });
            this.backup = `refs/patchwork/backups/${id}`;
            await this.repo.run(["update-ref", this.backup, this.head]);
            await this.repo.run(["rebase", "--interactive", ...(this.baseHash ? [this.baseHash] : ["--root"])], {
                env: { GIT_SEQUENCE_EDITOR: `cat ${quote(todo.replaceAll("\\", "/"))} >`, GIT_EDITOR: "true" },
            });
        });
        this.rows = []; this.render();
        this.status.setText(this.controller.operation?.kind === "rebase"
            ? `Rebase paused for editing. Amend the commit, then use Continue or Abort in Commit. Original history: ${this.backup}`
            : `Rebase completed. Original history: ${this.backup}`);
    }
}
