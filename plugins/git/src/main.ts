import { FileSystemAdapter, Plugin } from "obsidian";
import { installIcons } from "./utils/icons";
import { GitController } from "./controller";
import { installGitApi } from "./api";
import { installBordersIntegration } from "./integrations/borders";
import { GitSettingsStore } from "./settings-store";
import { GitHistoryService } from "./history/service";

export default class PatchworkGitPlugin extends Plugin {
    controller!: GitController;
    settingsStore!: GitSettingsStore;
    history!: GitHistoryService;

    get gitReady() { return this.controller?.ready ?? false; }
    get repositoryMissing() { return /not a git repository/i.test(this.controller?.error ?? ""); }
    get repository() { return this.controller.repository; }

    async onload() {
        if (!(this.app.vault.adapter instanceof FileSystemAdapter)) {
            throw new Error("Patchwork Git requires a desktop filesystem vault.");
        }
        installIcons(this);
        this.settingsStore = new GitSettingsStore(this);
        const data = await this.settingsStore.load();
        this.controller = new GitController(this, this.app.vault.adapter.getBasePath(), data);
        this.register(() => this.controller.dispose());
        this.controller.install();
        this.history = new GitHistoryService(this);
        this.register(() => this.history.dispose());
        installBordersIntegration(this);
        installGitApi(this.controller);
    }

    onunload() {
        this.history?.dispose();
        this.controller?.dispose();
        void this.settingsStore?.flush().catch(error => console.error("Could not flush Git settings.", error));
    }

    async onExternalSettingsChange() {
        await this.settingsStore.load();
    }
}
