import { Notice } from "obsidian";
import { updateMovedIndex } from "./utils/move-index";

/** Retain the actual old/new paths from vault events, including chained folder moves. */
export class GitMoveTracker {
    constructor(controller) {
        this.controller = controller;
        this.pending = [];
        this.generation = 0;
        controller.plugin.registerEvent(controller.app.vault.on("rename", (file, oldPath) => this.record(file.path, oldPath)));
        controller.plugin.register(() => { this.disposed = true; clearTimeout(this.timer); this.pending = []; });
    }

    record(newPath, oldPath) {
        const c = this.controller;
        // Git checkout/operation events must not feed back into the index.
        if (this.disposed || c.disposed || !c.ready || c.busy && !this.processing || c.operation) return;
        try {
            const from = c.repository.path(oldPath), to = c.repository.path(newPath);
            if (from === to || from === "." || to === ".") return;
            this.pending.push({ from, to, root: c.repository.root });
            this.generation++;
            this.schedule();
        } catch { c.scheduleRefresh(); /* The move crosses the active repository boundary. */ }
    }

    schedule() {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => void this.flush(), 150);
    }

    async flush() {
        const c = this.controller;
        if (this.disposed || c.disposed || !this.pending.length) return;
        if (this.processing || c.busy) { this.schedule(); return; }
        const batch = this.pending.splice(0), generation = this.generation;
        this.processing = true;
        try {
            await c.act(async () => {
                const validate = () => {
                    if (this.disposed || c.disposed || batch.some(move => move.root !== c.repository.root)) throw new Error("The move's repository is no longer active.");
                    if (generation !== this.generation) throw new Error("Files moved again while updating the index.");
                };
                const changes = await updateMovedIndex(c.repository, batch, validate);
                for (const { from, to } of changes) {
                    const list = c.changelists.assignments.get(from);
                    c.changelists.assignments.delete(from);
                    if (list) c.changelists.assignments.set(to, list);
                    if (c.selected.delete(from)) c.selected.add(to);
                }
                if (changes.length) c.saveDraft();
            }, true);
        } catch (error) {
            if (!this.disposed && generation !== this.generation) this.pending.unshift(...batch);
            else if (!this.disposed) new Notice(`Git move synchronization failed: ${error.message} Review the changes before committing.`, 10000);
        } finally {
            this.processing = false;
            if (!this.disposed && this.pending.length) this.schedule();
        }
    }
}
