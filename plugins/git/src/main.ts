import { FileSystemAdapter, Plugin } from "obsidian";
import { installIcons } from "../../utils/icons";
import { GitController } from "./controller";

export default class PatchworkGitPlugin extends Plugin {
    controller!: GitController;

    get gitReady() { return this.controller?.ready ?? false; }
    get repositoryMissing() { return /not a git repository/i.test(this.controller?.error ?? ""); }
    get repository() { return this.controller.repository; }

    async onload() {
        if (!(this.app.vault.adapter instanceof FileSystemAdapter)) {
            throw new Error("Patchwork Git requires a desktop filesystem vault.");
        }
        installIcons(this);
        this.controller = new GitController(this, this.app.vault.adapter.getBasePath(), await this.loadData());
        this.register(() => this.controller.dispose());
        this.controller.install();
    }
}
