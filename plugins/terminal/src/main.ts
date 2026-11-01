import { FileSystemAdapter, Plugin } from "obsidian";
import { installIcons } from "./utils/icons";
import { TerminalRuntime } from "./runtime";

export default class TerminalPlugin extends Plugin {
    onload(): void {
        if (!(this.app.vault.adapter instanceof FileSystemAdapter)) throw new Error("Terminal requires a desktop filesystem vault.");
        installIcons(this);
        const runtime = new TerminalRuntime(this);
        this.register(() => runtime.dispose());
        runtime.install();
    }
}
