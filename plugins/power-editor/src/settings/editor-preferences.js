import { Notice } from "obsidian";

/** Extend the existing core Editor settings instead of adding another settings tab. */
export function installEditorPreferences(plugin, attachments) {
    const tab = plugin.app.setting.settingTabs.find((item) => item.id === "editor");
    if (!tab?.getSettingDefinitions) return;
    const original = tab.getSettingDefinitions;
    const save = () => void plugin.persistSettings().catch(() => new Notice("Could not save editor preferences."));
    const wrapped = function (...args) {
        return [...original.apply(this, args), { type: "group", heading: "Patchwork", items: [
            { name: "Open files in new tabs", desc: "File-list clicks open a new tab, or focus the file if it is already open. Modified clicks keep their native behavior.", render: (row) => row.addToggle((toggle) => toggle.setValue(!!plugin.settings.explorerOpenInNewTab).onChange((value) => { plugin.settings.explorerOpenInNewTab = value; save(); })) },
            { name: "Hide attachment folders", desc: "Hide folders named exactly assets in the file list without affecting links or image rendering.", render: (row) => row.addToggle((toggle) => toggle.setValue(!!plugin.settings.hideAttachmentFolders).onChange((value) => {
                plugin.settings.hideAttachmentFolders = value;
                for (const { view } of plugin.app.workspace.getLeavesOfType("file-explorer")) view.sort();
                save();
            })) },
            { name: "Attachment location", desc: "Use an assets subfolder beside each note for newly pasted or imported attachments, including non-image attachments. Existing files are not moved.", render: (row) => row.addButton((button) => button.setButtonText("Use per-folder assets").onClick(() => {
                plugin.app.vault.setConfig("attachmentFolderPath", "./assets");
                new Notice("New attachments will be saved beside their note in assets.");
            })) },
            { name: "Unreferenced images", desc: "Scan the entire vault, review images in assets folders, and move only confirmed selections to recoverable trash.", render: (row) => row.addButton((button) => button.setButtonText("Review images").onClick(() => attachments.open())) },
        ] }];
    };
    tab.getSettingDefinitions = wrapped;
    plugin.register(() => { if (tab.getSettingDefinitions === wrapped) tab.getSettingDefinitions = original; });
}
