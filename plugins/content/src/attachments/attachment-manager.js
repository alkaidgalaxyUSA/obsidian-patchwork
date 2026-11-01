import { Notice } from "obsidian";
import { isImageCandidate, scanImageReferences } from "./reference-scan.js";
import { AttachmentReview } from "./attachment-review.js";

export class AttachmentManager {
    constructor(plugin) {
        this.app = plugin.app;
        this.revision = 0;
        this.disposed = false;
        this.cleaning = false;
        const changed = () => { this.revision++; };
        for (const event of ["create", "modify", "delete", "rename"]) plugin.registerEvent(this.app.vault.on(event, changed));
        for (const event of ["editor-change", "layout-change"]) plugin.registerEvent(this.app.workspace.on(event, changed));
        plugin.addCommand({ id: "review-unreferenced-images", name: "Review unreferenced images", callback: () => this.open() });
        plugin.register(() => { this.disposed = true; this.review?.close(); });
    }

    open() {
        if (this.disposed) return;
        if (this.review) { this.review.modalEl.focus(); return; }
        this.review = new AttachmentReview(this);
        this.review.open();
    }

    scan(cancelled = () => false) {
        return scanImageReferences(this.app, () => this.revision, () => this.disposed || cancelled());
    }

    async trash(selected, progress) {
        if (this.cleaning || this.disposed) return [];
        this.cleaning = true;
        const results = [];
        try {
            for (const snapshot of selected) {
                if (this.disposed) break;
                progress(`Rechecking ${results.length + 1} of ${selected.length}...`);
                const file = this.app.vault.getAbstractFileByPath(snapshot.path);
                if (file !== snapshot.file || !file || !isImageCandidate(file, this.app.vault.configDir)
                    || file.stat.size !== snapshot.size || file.stat.mtime !== snapshot.mtime) {
                    results.push({ path: snapshot.path, state: "Skipped", reason: "File moved, changed, or disappeared." }); continue;
                }
                try {
                    // Re-evaluate the entire active vault immediately before EACH file.
                    const fresh = await this.scan();
                    const reason = fresh.limitations[0] ?? (fresh.referenced.has(file.path) ? "File is now referenced." : undefined);
                    if (reason || fresh.revision !== this.revision || this.disposed
                        || this.app.vault.getAbstractFileByPath(snapshot.path) !== file
                        || file.stat.size !== snapshot.size || file.stat.mtime !== snapshot.mtime) {
                        results.push({ path: snapshot.path, state: "Skipped", reason: reason ?? "Vault changed during verification." }); continue;
                    }
                    // false explicitly selects Obsidian's recoverable local .trash.
                    // Never use fileManager.trashFile (which follows permanent-delete preferences).
                    await this.app.vault.trash(file, false);
                    results.push({ path: snapshot.path, state: "Trashed", reason: "Recover from the vault's .trash folder." });
                } catch {
                    results.push({ path: snapshot.path, state: "Failed", reason: "Verification or recoverable trash failed. No permanent-delete fallback was used." });
                }
            }
        } finally { this.cleaning = false; }
        new Notice(`${results.filter((item) => item.state === "Trashed").length} images moved to .trash; ${results.filter((item) => item.state === "Skipped").length} skipped; ${results.filter((item) => item.state === "Failed").length} failed.`);
        return results;
    }
}
