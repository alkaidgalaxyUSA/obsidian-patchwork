import { Notice, Setting } from "obsidian";
import type { Plugin } from "obsidian";
import type { Disposable } from "../../../contracts/common";
import { getServiceRegistry } from "../../../utils/service-registry";

export function installModulePreferences(plugin: Plugin, attachments: { open(): void }): void {
    let registration: Disposable | undefined;
    const stop = getServiceRegistry(plugin.app).watch("content", "borders", borders => {
        registration?.dispose(); registration = undefined;
        if (!borders) return;
        registration = borders.registerSettings({
            id: "content:attachments", owner: "content", target: "editor", order: 20,
            mount(host) {
                new Setting(host).setName("Attachment location")
                    .setDesc("Use an assets subfolder beside each note for newly pasted or imported attachments. Existing files are not moved.")
                    .addButton(button => button.setButtonText("Use per-folder assets").onClick(() => {
                        const config = plugin.app.vault as typeof plugin.app.vault & { setConfig(key: string, value: string): void };
                        config.setConfig("attachmentFolderPath", "./assets");
                        new Notice("New attachments will be saved beside their note in assets.");
                    }));
                new Setting(host).setName("Unreferenced images")
                    .setDesc("Review images in assets folders and move confirmed selections to recoverable trash.")
                    .addButton(button => button.setButtonText("Review images").onClick(() => attachments.open()));
                return { dispose() { host.replaceChildren(); } };
            },
        });
    });
    plugin.register(() => { stop(); registration?.dispose(); });
}
