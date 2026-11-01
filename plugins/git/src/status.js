import { isAbsolute, relative, resolve } from "node:path";
import { fileStatus } from "./utils/file-status";

/** Publish repository state as data; consumers own their own filename rendering. */
export class GitSnapshots {
    constructor(controller) { this.controller = controller; this.listeners = new Set(); }

    vaultPath(path) {
        if (!path) return undefined;
        const result = relative(this.controller.repository.vaultPath, resolve(this.controller.repository.root, path)).replaceAll("\\", "/");
        return isAbsolute(result) || result === ".." || result.startsWith("../") ? undefined : result;
    }

    /** @returns {import("../../contracts/git").GitSnapshot} */
    snapshot() {
        const controller = this.controller;
        const status = [];
        if (controller.ready && !controller.disposed) for (const entry of [...controller.ignored, ...controller.entries]) {
            const vaultPath = this.vaultPath(entry.path);
            const originalVaultPath = this.vaultPath(entry.original);
            if (vaultPath === undefined && originalVaultPath === undefined) continue;
            status.push({ vaultPath: vaultPath ?? originalVaultPath, originalVaultPath, state: fileStatus(entry) });
        }
        const detached = controller.branch?.startsWith("Detached ");
        return { ready: controller.ready && !controller.disposed, busy: controller.busy,
            error: controller.error || undefined, branch: detached ? undefined : controller.branch,
            detachedCommit: detached ? controller.branch.slice("Detached ".length) : undefined, status };
    }
    deliver(listener, snapshot) {
        try { listener({ ...snapshot, status: snapshot.status.map(entry => ({ ...entry })) }); }
        catch (error) { console.error("Git snapshot subscriber failed.", error); }
    }
    publish() {
        const snapshot = this.snapshot(), signature = JSON.stringify(snapshot);
        if (signature === this.signature) return;
        this.signature = signature;
        for (const listener of [...this.listeners]) this.deliver(listener, snapshot);
    }
    subscribe(listener) {
        this.deliver(listener, this.snapshot());
        if (this.controller.disposed) return () => {};
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }
    dispose() { this.publish(); this.listeners.clear(); }
}
