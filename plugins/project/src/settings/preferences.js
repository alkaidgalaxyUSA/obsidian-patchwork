import { Notice, Setting } from "obsidian";
import { getServiceRegistry } from "../../../utils/service-registry";

/** Project-owned settings contributions in the native Editor section. */
export function installProjectPreferences(plugin) {
    let handle;
    const stop = getServiceRegistry(plugin.app).watch("project", "borders", borders => {
        handle?.dispose(); handle = undefined;
        if (!borders) return;
        handle = borders.registerSettings({ id: "project:explorer", owner: "project", target: "editor", order: 10,
            mount(host) {
                const save = () => void plugin.persistSettings().catch(() => new Notice("Could not save file-list preferences."));
                new Setting(host).setName("Open files in new tabs")
                    .setDesc("File-list clicks open a new tab, or focus the file if it is already open. Modified clicks keep their native behavior.")
                    .addToggle(toggle => toggle.setValue(!!plugin.settings.explorerOpenInNewTab).onChange(value => { plugin.settings.explorerOpenInNewTab = value; save(); }));
                new Setting(host).setName("Hide attachment folders")
                    .setDesc("Hide folders named exactly assets without affecting links or image rendering.")
                    .addToggle(toggle => toggle.setValue(!!plugin.settings.hideAttachmentFolders).onChange(value => {
                        plugin.settings.hideAttachmentFolders = value;
                        for (const { view } of plugin.app.workspace.getLeavesOfType("file-explorer")) view.sort?.();
                        save();
                    }));
                return { dispose() { host.replaceChildren(); } };
            },
        });
    });
    plugin.register(() => { stop(); handle?.dispose(); });
}
