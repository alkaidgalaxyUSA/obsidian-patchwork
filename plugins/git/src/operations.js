import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

/** Recover native Git operations, including operations started outside Patchwork. */
export class GitOperations {
    constructor(repository) { this.repository = repository; }

    async state() {
        const repo = this.repository;
        const markers = [["rebase-merge", "rebase"], ["rebase-apply", "rebase"],
            ["MERGE_HEAD", "merge"], ["CHERRY_PICK_HEAD", "cherry-pick"], ["REVERT_HEAD", "revert"], ["sequencer", "sequencer"]];
        for (const [marker, operation] of markers) {
            const path = resolve(repo.gitDir, marker);
            let info;
            try { info = await stat(path); }
            catch (error) { if (error.code === "ENOENT") continue; throw error; }
            let kind = operation;
            if (marker === "rebase-apply") {
                // git am uses this directory too; never issue rebase commands for it.
                try { await stat(resolve(path, "applying")); kind = "am"; }
                catch (error) { if (error.code !== "ENOENT") throw error; }
            }
            if (kind === "sequencer") {
                const todo = await readFile(resolve(path, "todo"), "utf8");
                kind = /^revert\s/m.test(todo) ? "revert" : /^pick\s/m.test(todo) ? "cherry-pick" : "sequencer";
            }
            let editing = false;
            if (marker === "rebase-merge") {
                try { editing = /^[a-f\d]{40,64}$/i.test((await readFile(resolve(path, "amend"), "utf8")).trim()); }
                catch (error) { if (error.code !== "ENOENT") throw error; }
            }
            return { kind, editing, token: `${repo.root}:${marker}:${info.mtimeMs}:${await repo.head()}` };
        }
        return undefined;
    }

    async validate(expected) {
        const current = await this.state();
        if (current?.token !== expected?.token || current?.kind !== expected?.kind) {
            throw new Error("The Git operation changed. Refresh and try again.");
        }
        return current;
    }

    async resume(expected, action) {
        const state = await this.validate(expected);
        if (!state || !["merge", "rebase", "cherry-pick", "revert", "am"].includes(state.kind)) throw new Error("Finish this operation using Git in a terminal.");
        if (!["continue", "abort", "skip"].includes(action) || action === "skip" && !["rebase", "am"].includes(state.kind)) throw new Error("This operation does not support that action.");
        if (action === "continue" && (await this.repository.status()).some(entry => entry.conflict)) {
            throw new Error("Resolve and mark every conflicting file before continuing.");
        }
        await this.repository.run([state.kind, `--${action}`], { env: { GIT_EDITOR: "true", GIT_SEQUENCE_EDITOR: "true" } });
    }

    async amend(expected, message, checks) {
        const state = await this.validate(expected);
        if (state?.kind !== "rebase" || !state.editing) throw new Error("Rebase is not stopped for editing a commit.");
        if (!message.trim()) throw new Error("Enter a commit message.");
        if ((await this.repository.status()).some(entry => entry.conflict)) throw new Error("Resolve all conflicts before amending.");
        await this.repository.checkCommitIndex(checks);
        await this.validate(expected);
        await this.repository.run(["commit", "--amend", "-m", message]);
    }

    async markResolved(expected, path) {
        await this.validate(expected);
        const entry = (await this.repository.status()).find(entry => entry.path === path && entry.conflict);
        if (!entry) throw new Error("This file is no longer conflicted. Refresh the changes.");
        try {
            const content = await readFile(resolve(this.repository.root, path));
            if (!content.includes(0) && /^(?:<{7,}|={7,}|>{7,}|\|{7,})(?: |\r?$)/m.test(content.toString("utf8"))) {
                throw new Error("Conflict markers remain in this file. Resolve them in the editor first.");
            }
        } catch (error) { if (error.code !== "ENOENT") throw error; }
        await this.validate(expected);
        await this.repository.stage([path]);
    }
}
