import { Notice } from "obsidian";

/** Titlebar adapter for the independent Patchwork Git plugin. */
export class GitRepository {
    constructor(app) { this.app = app; }

    get plugin() { return this.app.plugins.plugins["patchwork-git"]; }

    async snapshot() {
        const plugin = this.plugin;
        if (!plugin) throw new Error("Enable Patchwork Git to use repository actions.");
        await plugin.controller.refresh();
        if (!plugin.gitReady) throw new Error(plugin.controller.error || "Git is not ready.");
        return plugin.repository.snapshot();
    }

    command(id) {
        if (!this.app.commands.executeCommandById(`patchwork-git:${id}`)) new Notice("This Git action is currently unavailable.");
    }

    checkout(ref, remote = false) {
        if (!this.plugin?.gitReady) { new Notice("Patchwork Git is not ready."); return; }
        void this.plugin.controller.checkout(ref, remote);
    }
}
