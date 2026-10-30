import { PluginSettingTab } from "obsidian";

export class GitSettings extends PluginSettingTab {
    constructor(app, plugin, controller) { super(app, plugin); this.controller = controller; }
    display() {
        this.containerEl.empty();
        this.containerEl.createEl("h2", { text: "Patchwork Git" });
        this.containerEl.createEl("p", { text: this.controller.ready ? `Repository: ${this.controller.repository.root}` : this.controller.error || "Loading repository…" });
        this.containerEl.createEl("p", { text: "Uses your installed Git, repository identity, remotes, upstreams and credential helper. Pull uses fast-forward only. Push never forces updates." });
        this.containerEl.createEl("button", { text: "Refresh repository" }).onclick = async () => { await this.controller.refresh(); this.display(); };
    }
}
