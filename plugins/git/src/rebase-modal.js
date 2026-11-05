import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { GitTaskModal } from "./ui/task-modal";
import { confirm } from "./dialogs";
import { setIcon } from "./utils/icons";
import { rebaseGroups, rebasePlanError } from "./utils/rebase-plan";
import { writeRebaseEditor } from "./utils/rebase-todo";

/** Build Git's native interactive todo; native continuation handles conflicts. */
export class GitRebaseModal extends GitTaskModal {
    constructor(controller, base = "HEAD~1") { super(controller, "Interactive Rebase"); this.base = base; }
    onOpen() {
        super.onOpen();
        this.upstream = this.field("Rebase commits after (or ROOT)", this.base);
        this.help = this.body.createDiv({ cls: "pw-git-task-help", text: "Commits are ordered oldest first. Use Ctrl/Cmd to select commits and Shift to select a range. Selected commits can be moved or changed together. A backup reference is created before rewriting." });
        const toolbar = this.body.createDiv({ cls: "pw-git-rebase-toolbar", attr: { role: "group", "aria-label": "Commit actions" } });
        this.moveButtons = [-1, 1].map(delta => {
            const title = delta < 0 ? "Move commit earlier" : "Move commit later";
            const button = toolbar.createEl("button", { cls: "clickable-icon", attr: { type: "button", title, "aria-label": title } });
            setIcon(button, `idea/expui/general/${delta < 0 ? "moveUp" : "moveDown"}_dark.svg`);
            button.onclick = () => this.move(delta);
            this.controls.push(button); return button;
        });
        this.selection = new Set();
        this.actionButtons = new Map();
        for (const [action, label] of [["pick", "Pick"], ["edit", "Stop to Edit"], ["reword", "Reword"], ["squash", "Squash"], ["fixup", "Fixup"], ["drop", "Drop"]]) {
            const button = toolbar.createEl("button", { text: label, attr: { type: "button" } });
            button.setAttribute("aria-label", label);
            if (action === "pick" || action === "edit") {
                button.empty(); button.addClass("clickable-icon");
                setIcon(button, action === "pick" ? "git-rollback" : "idea-expui-run-pause_dark.svg");
            }
            button.onclick = () => this.applyAction(action);
            this.actionButtons.set(action, button); this.controls.push(button);
        }
        this.list = this.body.createDiv({ cls: "pw-git-rebase-list" });
        const messageLabel = this.body.createEl("label", { cls: "pw-git-rebase-message" });
        this.messageLabel = messageLabel.createSpan({ text: "Commit message" });
        this.message = messageLabel.createEl("textarea", { attr: { "aria-label": "Commit message", spellcheck: "false", rows: "4" } });
        this.controls.push(this.message);
        this.message.oninput = () => {
            if (this.pending || this.selection.size !== 1 || !this.selected) return;
            const group = this.messageGroup();
            if (group?.squash) group.root.squashEdit = { signature: group.signature, message: this.message.value };
            else if (this.selected.action === "reword") this.selected.message = this.message.value;
            this.updateActions();
        };
        this.button("Load Commits", () => this.load());
        this.restoreButton = this.button("Reset Actions", () => {
            this.rows = this.originalRows.map(row => ({ ...row }));
            this.selected = undefined; this.anchor = undefined; this.selection.clear();
            this.render(); this.status.setText("Original commit order, actions and messages restored.");
        });
        this.startButton = this.button("Start Rebase…", () => this.start(), true);
        this.upstream.oninput = () => this.updateActions();
        this.updateActions();
        void this.perform(() => this.load());
    }
    updateActions() {
        if (!this.startButton) return;
        const reason = !this.rows?.length || this.loadedBase !== this.upstream.value.trim() ? "Load a valid, nonempty commit range before starting rebase."
            : !this.clean ? "Commit or stash local changes, then reload the commits."
            : this.controller.operation ? "Finish or abort the active Git operation first."
            : rebasePlanError(this.rows, this.loadedBase === "ROOT");
        this.startButton.disabled = this.pending || !!reason;
        this.startButton.title = reason;
        this.restoreButton.disabled = this.pending || !this.originalRows?.length || JSON.stringify(this.rows) === JSON.stringify(this.originalRows);
        const selected = this.selectedRows();
        for (const [action, button] of this.actionButtons) {
            const reason = this.actionReason(action);
            button.disabled = this.pending || !!reason;
            button.title = reason || button.getAttribute("aria-label");
        }
        this.message.disabled = this.pending || selected.length !== 1;
        this.message.readOnly = !this.messageGroup()?.squash && this.selected?.action !== "reword";
        this.moveButtons.forEach((button, direction) => {
            button.disabled = this.pending || this.hasMerges || !selected.length || this.selection.has(direction === 0 ? this.rows?.[0] : this.rows?.at(-1));
        });
        for (const button of this.list.querySelectorAll("button")) button.disabled = this.pending;
    }
    selectedRows() { return (this.rows || []).filter(row => this.selection.has(row)); }
    messageGroup() {
        try { return rebaseGroups(this.rows || []).find(group => group.rows.includes(this.selected)); }
        catch { return undefined; }
    }
    actionReason(action) {
        const selected = this.selectedRows();
        if (!selected.length) return "Select commits first.";
        if (this.hasMerges && ["squash", "fixup"].includes(action)) return "Combining rows is unavailable while preserving merge topology.";
        if (selected.some(row => row.merge) && !["pick", "reword"].includes(action)) return "Merge commits can be kept or reworded while preserving topology.";
        if (action === "reword" && selected.length !== 1) return "Select one commit to edit its message.";
        if (["squash", "fixup"].includes(action)) {
            if (selected.some(row => row.action === "drop")) return "Restore dropped commits with Pick before combining them.";
            if (selected.length === 1 && !(this.rows || []).slice(0, this.rows.indexOf(selected[0])).some(row => row.action !== "drop")) return "Select at least two commits, or a commit with a preceding retained commit.";
        }
        return "";
    }
    applyAction(action) {
        if (this.pending || this.actionReason(action)) return;
        const selected = this.selectedRows();
        if (!selected.includes(this.selected)) this.selected = selected[0];
        if (["squash", "fixup"].includes(action) && selected.length > 1) {
            // Move the selected commits together in their existing relative order.
            const first = this.rows.indexOf(selected[0]);
            this.rows = this.rows.filter(row => !this.selection.has(row));
            this.rows.splice(first, 0, ...selected);
            if (["squash", "fixup"].includes(selected[0].action)) selected[0].action = "pick";
            for (const row of selected.slice(1)) row.action = action;
        } else for (const row of selected) row.action = action;
        if (["squash", "reword"].includes(action)) {
            const group = this.messageGroup();
            if (group?.squash) this.selected = group.root;
            this.selection = new Set([this.selected]);
            this.anchor = this.selected;
        }
        this.render();
        if (["squash", "reword"].includes(action)) this.message.focus();
    }
    async load() {
        this.rows = [];
        this.hasMerges = false;
        this.originalRows = [];
        this.clean = false;
        this.selected = undefined; this.anchor = undefined; this.selection.clear();
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
        this.hasMerges = !!(await this.repo.run(["rev-list", "--merges", range])).trim();
        const raw = await this.repo.run(["log", "--topo-order", "--reverse", "--format=%H%x00%s%x00%B%x00%P%x00", range]);
        const parts = raw.split("\0"); this.rows = [];
        for (let index = 0; index + 3 < parts.length; index += 4) {
            const hash = parts[index].trim(); if (hash) this.rows.push({ hash, subject: parts[index + 1], action: "pick", message: parts[index + 2], merge: parts[index + 3].trim().split(/\s+/).length > 1 });
        }
        this.help.setText(this.hasMerges
            ? "Merge topology is preserved by Git. Keep or Reword merge commits; other commits also support Stop to Edit and Drop. Reordering and combining rows are unavailable in this mode."
            : "Commits are ordered oldest first. Ctrl/Cmd selects commits; Shift selects a range. Move or change selected commits together. A backup reference is created before rewriting.");
        this.originalRows = this.rows.map(row => ({ ...row }));
        this.clean = !(await this.repo.status()).length;
        this.validate(); this.render(); this.status.setText(this.clean ? `${this.rows.length} commits to review` : "Commit or stash local changes, then reload the commits.");
    }
    render() {
        this.list.empty();
        if (!this.rows.includes(this.selected)) { this.selected = this.rows[0]; this.selection = new Set(this.selected ? [this.selected] : []); }
        this.selection = new Set([...this.selection].filter(row => this.rows.includes(row)));
        if (!this.anchor) this.anchor = this.selected;
        const table = this.list.createEl("table", { attr: { role: "grid", "aria-label": "Rebase commits", "aria-multiselectable": "true" } });
        const header = table.createEl("thead").createEl("tr");
        for (const text of ["Commit", "Action", "Subject"]) header.createEl("th", { text, attr: { scope: "col" } });
        const body = table.createEl("tbody");
        this.rows.forEach(commit => {
            const row = body.createEl("tr", { cls: this.selection.has(commit) ? "is-selected" : "", attr: { "aria-selected": String(this.selection.has(commit)) } });
            row.createEl("td", { text: commit.hash.slice(0, 8), attr: { title: commit.hash } });
            row.createEl("td", { text: commit.merge && commit.action === "pick" ? "merge" : commit.action });
            const button = row.createEl("td").createEl("button", { text: commit.subject, attr: { type: "button", "aria-pressed": String(this.selection.has(commit)) } });
            button.tabIndex = commit === this.selected ? 0 : -1;
            row.onclick = event => this.select(commit, event);
            button.onkeydown = event => this.navigate(commit, event);
        });
        const group = this.messageGroup();
        this.messageLabel.setText(this.selection.size > 1 ? `${this.selection.size} commits selected` : group?.squash ? "Combined commit message" : "Commit message (editable for Reword)");
        this.message.value = this.selection.size !== 1 ? "" : group?.squash ? group.message : this.selected?.message ?? "";
        this.updateActions();
    }
    select(commit, event = {}) {
        if (this.pending) return;
        if (event.shiftKey && this.anchor && this.rows.includes(this.anchor)) {
            const [start, end] = [this.rows.indexOf(this.anchor), this.rows.indexOf(commit)].sort((a, b) => a - b);
            this.selection = new Set(this.rows.slice(start, end + 1));
        } else if (event.ctrlKey || event.metaKey) {
            if (this.selection.has(commit)) this.selection.delete(commit); else this.selection.add(commit);
            this.anchor = commit;
        } else { this.selection = new Set([commit]); this.anchor = commit; }
        this.selected = !this.selection.has(commit) && this.selection.size ? [...this.selection].at(-1) : commit;
        this.render(); this.focusSelected();
    }
    focusSelected() {
        const button = this.list.querySelectorAll("tbody button")[this.rows.indexOf(this.selected)];
        button?.focus({ preventScroll: true }); button?.scrollIntoView({ block: "nearest" });
    }
    navigate(commit, event) {
        if (this.pending || event.isComposing) return;
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
            event.preventDefault(); this.selection = new Set(this.rows); this.render(); this.focusSelected(); return;
        }
        if (event.key === "Delete") { event.preventDefault(); this.applyAction("drop"); this.focusSelected(); return; }
        if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        if (event.altKey && event.key.startsWith("Arrow")) { this.move(event.key === "ArrowUp" ? -1 : 1); this.focusSelected(); return; }
        const index = event.key === "Home" ? 0 : event.key === "End" ? this.rows.length - 1 : this.rows.indexOf(commit) + (event.key === "ArrowUp" ? -1 : 1);
        const next = this.rows[Math.max(0, Math.min(this.rows.length - 1, index))];
        if (next) this.select(next, { shiftKey: event.shiftKey });
    }
    move(delta) {
        if (this.pending || this.hasMerges || !this.selection.size || this.selection.has(delta < 0 ? this.rows[0] : this.rows.at(-1))) return;
        const indices = this.rows.map((_, index) => index);
        if (delta > 0) indices.reverse();
        for (const index of indices) if (this.selection.has(this.rows[index])) [this.rows[index], this.rows[index + delta]] = [this.rows[index + delta], this.rows[index]];
        this.render(); this.list.querySelectorAll("tbody tr")[this.rows.indexOf(this.selected)]?.scrollIntoView({ block: "nearest" });
    }
    async start() {
        if (!this.rows?.length || this.upstream.value.trim() !== this.loadedBase) throw new Error("Load the commits first.");
        const rows = this.rows.map(row => ({ ...row }));
        const error = rebasePlanError(rows, this.loadedBase === "ROOT");
        if (error) throw new Error(error);
        if (!await confirm(this.controller, "Rewrite branch history", `Rewrite ${rows.length} commits on ${this.branch}? Already-pushed commits will have new hashes. A backup ref will retain the original history.`, "Start Rebase")) return;
        await this.change(async () => {
            await this.repo.assertNoOperation();
            if (await this.repo.head() !== this.head || await this.repo.branch() !== this.branch) throw new Error("The branch changed. Reload commits.");
            if ((await this.repo.status()).length) throw new Error("Commit or stash all changes before rebasing.");
            const id = randomUUID(), directory = join(this.repo.gitDir, "patchwork-rebase", id);
            await mkdir(directory, { recursive: true });
            const editor = await writeRebaseEditor(rows, directory, this.hasMerges);
            this.backup = `refs/patchwork/backups/${id}`;
            await this.repo.run(["update-ref", this.backup, this.head]);
            await this.repo.run(["-c", `core.abbrev=${this.head.length}`, "-c", "rebase.abbreviateCommands=false", "-c", "rebase.instructionFormat=%s", "-c", "rebase.autoSquash=false", "-c", "rebase.autoStash=false", "-c", "rebase.updateRefs=false", "-c", "rebase.rescheduleFailedExec=true", "rebase", "--interactive", ...(this.hasMerges ? ["--rebase-merges"] : []), ...(this.baseHash ? [this.baseHash] : ["--root"])], {
                env: { GIT_SEQUENCE_EDITOR: editor, GIT_EDITOR: "true" },
            });
        });
        this.rows = []; this.originalRows = []; this.render();
        this.status.setText(this.controller.operation?.kind === "rebase"
            ? `Rebase paused for editing. Amend the commit, then use Continue or Abort in Commit. Original history: ${this.backup}`
            : `Rebase completed. Original history: ${this.backup}`);
    }
}
