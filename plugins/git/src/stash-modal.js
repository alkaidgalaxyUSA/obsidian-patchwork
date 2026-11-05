import { GitTaskModal } from "./ui/task-modal";
import { confirm } from "./dialogs";

export class GitStashModal extends GitTaskModal {
    constructor(controller) { super(controller, "Stashes and Shelved Changes"); }
    onOpen() {
        super.onOpen();
        this.name = this.field("New stash message", "Local changes");
        this.stashButton = this.button("Stash All Changes", async () => {
            if (!await confirm(this.controller, "Stash all changes", "Save tracked and untracked files in a stash and remove those changes from the working tree?", "Stash")) return;
            await this.change(async () => { await this.repo.assertNoOperation(); await this.repo.run(["stash", "push", "--include-untracked", "-m", this.name.value.trim() || "Local changes"], { env: { GIT_LITERAL_PATHSPECS: "0" } }); });
            await this.load();
        }, true);
        this.button("Refresh", () => this.load());
        this.list = this.body.createDiv({ cls: "pw-git-manager-list" });
        void this.perform(() => this.load());
    }
    updateActions() {
        this.stashButton.disabled = this.pending || !this.canStash || !!this.controller.operation;
        this.stashButton.title = this.controller.operation ? "Finish or abort the active Git operation first." : !this.canStash ? "No stashable changes, or unresolved conflicts remain." : "";
    }
    async load() {
        const entries = await this.repo.status();
        this.canStash = entries.length > 0 && !entries.some(entry => entry.conflict);
        const raw = await this.repo.run(["stash", "list", "--format=%gd%x00%H%x00%gs%x00"]);
        const shelves = await this.repo.shelves.list(); this.validate(); this.list.empty();
        const parts = raw.split("\0");
        for (let index = 0; index + 2 < parts.length; index += 3) {
            const ref = parts[index].trim(), hash = parts[index + 1], message = parts[index + 2];
            if (!ref) continue;
            const row = this.list.createDiv({ cls: "pw-git-manager-row" });
            row.createSpan({ text: `${ref} · ${message}` });
            this.button("Preview", async () => {
                const text = await this.repo.run(["stash", "show", "--include-untracked", "--patch", "--no-ext-diff", "--no-textconv", "--no-color", hash]); this.validate();
                await this.controller.openDiffText(text, `Stash: ${message}`, this.context.document);
            }, false, row);
            const apply = this.button("Apply", async () => {
                if (!await confirm(this.controller, "Apply stash", `Apply ${ref}? The stash is retained. Conflicts can be resolved in Commit.`, "Apply")) return;
                await this.change(async () => { await this.repo.assertNoOperation(); await this.repo.run(["stash", "apply", "--index", hash]); });
                this.status.setText("Stash applied and retained.");
            }, false, row);
            apply.disabled = !!this.controller.operation;
            apply.title = apply.disabled ? "Finish or abort the active Git operation first." : "";
            this.button("Delete…", async () => {
                if (!await confirm(this.controller, "Delete stash", `Permanently delete ${ref}: ${message}?`, "Delete")) return;
                await this.change(async () => {
                    if ((await this.repo.run(["rev-parse", "--verify", ref])).trim() !== hash) throw new Error("Stashes changed. Refresh before deleting.");
                    await this.repo.run(["stash", "drop", ref]);
                }); await this.load();
            }, false, row);
        }
        for (const shelf of shelves) {
            const row = this.list.createDiv({ cls: "pw-git-manager-row" });
            row.createSpan({ text: `Shelf · ${shelf.title} · ${shelf.paths.length} files` });
            this.button("Restore", async () => { await this.controller.restoreShelf(shelf); await this.load(); }, false, row);
        }
        this.status.setText(this.list.childElementCount ? "Apply keeps the stash so it remains recoverable." : "No stashes or shelves.");
    }
}
