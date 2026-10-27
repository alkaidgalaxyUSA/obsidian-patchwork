import { SettingTab, Setting, apiVersion } from "obsidian";

class AboutTab extends SettingTab {
    constructor(app) {
        super(app, app.setting);
        this.id = "patchwork-about";
        this.name = "About";
        this.icon = "info";
    }

    display() {
        this.containerEl.empty();
        this.containerEl.createEl("h2", { text: "About" });
        this.containerEl.createEl("p", { text: `Obsidian ${apiVersion}` });
        for (const [name, description, label, url] of [
            ["Official help site", "Read the official Obsidian documentation in multiple languages.", "Visit", "https://obsidian.md/help"],
            ["Discord chat", "Chat with experienced Obsidian users from around the world.", "Join", "https://discord.gg/veuWUTm"],
            ["Official forum", "Ask questions, share feature requests, report bugs, and discuss knowledge management.", "Visit", "https://forum.obsidian.md"],
        ]) {
            new Setting(this.containerEl).setName(name).setDesc(description)
                .addButton((button) => button.setButtonText(label).onClick(() => window.open(url)));
        }
        new Setting(this.containerEl).setName("Sandbox vault")
            .setDesc("Experiment with Obsidian features. Changes in the sandbox will not be saved.")
            .addButton((button) => button.setButtonText("Open").onClick(() => this.app.commands.executeCommandById("app:open-sandbox-vault")));
    }
}

export function installAboutTab(plugin) {
    const setting = plugin.app.setting;
    // Native removal unregisters a tab but leaves regular settings navigation DOM behind.
    for (const old of [...setting.settingTabs].filter((item) => item.id === "patchwork-about")) {
        old.navEl?.remove();
        setting.removeSettingTab(old);
    }
    for (const nav of setting.tabContainer.querySelectorAll('[data-setting-id="patchwork-about"]')) nav.remove();
    const tab = new AboutTab(plugin.app);
    setting.addSettingTab(tab);
    plugin.register(() => {
        tab.navEl?.remove();
        setting.removeSettingTab(tab);
        tab.containerEl?.remove();
    });
}
