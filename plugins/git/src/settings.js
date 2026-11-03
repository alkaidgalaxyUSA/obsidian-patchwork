import { PluginSettingTab, Setting, Notice } from "obsidian";
import { Repository } from "./repository";
import { protectedBranchPatterns } from "./utils/branch-protection";

export class GitSettings extends PluginSettingTab {
    constructor(app, plugin, controller) { super(app, plugin); this.controller = controller; }
    display() {
        const controller = this.controller, repo = controller.repository;
        this.containerEl.empty();
        this.containerEl.createEl("h2", { text: "Patchwork Git" });
        this.containerEl.createEl("p", { text: this.controller.ready ? `Repository: ${this.controller.repository.root}` : this.controller.error || "Loading repository…" });
        let executable = repo.executable;
        new Setting(this.containerEl).setName("Git executable").setDesc("Use git from PATH or an absolute executable path. No tools are installed.")
            .addText(text => text.setValue(executable).onChange(value => { executable = value.trim(); }))
            .addButton(button => button.setButtonText("Validate and Save").onClick(async () => {
                if (controller.busy) { new Notice("Git is busy."); return; }
                const probe = new Repository(repo.root, executable || "git");
                try {
                    const version = await probe.run(["--version"]);
                    if (controller.busy || controller.disposed) throw new Error("Git became unavailable. Retry when idle.");
                    repo.executable = executable || "git";
                    await this.plugin.settingsStore.savePreferences({ executable: repo.executable });
                    new Notice(version.trim());
                } catch (error) { new Notice(error.message); } finally { probe.dispose(); }
            }));
        this.containerEl.createEl("p", { text: "Identity and signing changes below apply only to the selected repository. Network authentication uses Git's configured credential helper and SSH agent." });
        const fields = this.containerEl.createDiv();
        const root = repo.root;
        let protection = protectedBranchPatterns(controller).join("\n");
        new Setting(this.containerEl).setName("Protected remote branches").setDesc("One full-name regular expression per line, without the remote prefix. Defaults: main and master. Prevents remote deletion in Patchwork; remote-server rules are not synchronized.")
            .addTextArea(text => text.setValue(protection).onChange(value => { protection = value; }))
            .addButton(button => button.setButtonText("Save for this repository").onClick(async () => {
                try {
                    if (repo.root !== root) throw new Error("The repository changed. Reopen settings.");
                    const patterns = protection.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
                    for (const pattern of patterns) new RegExp(`^(?:${pattern})$`);
                    const previous = this.plugin.settingsStore.preferences.protectedBranchesByRoot || {};
                    await this.plugin.settingsStore.savePreferences({ protectedBranchesByRoot: { ...previous, [root]: patterns } });
                    controller.render(); new Notice("Branch protection rules saved.");
                } catch (error) { new Notice(error.message); }
            }));
        void Promise.all(["user.name", "user.email", "user.signingkey", "commit.gpgsign"].map(async key => [key, (await repo.run(["config", "--get", key], { allowedExitCodes: [1] })).trim()]))
            .then(values => {
                if (!fields.isConnected || repo.root !== root) return;
                for (const [key, initial] of values) {
                    let value = initial;
                    const setting = new Setting(fields).setName(key);
                    if (key === "commit.gpgsign") setting.addToggle(toggle => toggle.setValue(initial === "true").onChange(enabled => { value = String(enabled); }));
                    else setting.addText(text => text.setValue(initial).onChange(next => { value = next; }));
                    setting.addButton(button => button.setButtonText("Save locally").onClick(() => controller.act(() => {
                        if (repo.root !== root) throw new Error("The repository changed. Reopen settings.");
                        return repo.run(value.trim() ? ["config", "--local", key, value.trim()] : ["config", "--local", "--unset-all", key], { allowedExitCodes: value.trim() ? [] : [5] });
                    })));
                }
            }).catch(error => { if (fields.isConnected) fields.setText(error.message); });
        for (const [name, title] of [["repositories", "Repositories and Submodules"], ["tags", "Tags"], ["stashes", "Stashes and Shelves"], ["worktrees", "Worktrees"], ["rebase", "Interactive Rebase"], ["reset", "Reset HEAD"]]) {
            new Setting(this.containerEl).setName(title).addButton(button => button.setButtonText("Open").onClick(() => controller.openManager(name)));
        }
    }
}
