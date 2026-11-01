import { ModuleUnavailableError } from "../../../utils/module-errors";

/** Existing optional creation integrations; private upstream details stay here. */
export async function createExternalDocument(app, id, folder) {
    if (id === "obsidian-excalidraw-plugin:excalidraw-autocreate-newtab") {
        const drawing = app.plugins?.plugins?.["obsidian-excalidraw-plugin"];
        if (typeof drawing?.createAndOpenDrawing !== "function" || !drawing.settings) throw new ModuleUnavailableError("project", "The Excalidraw creation integration is unavailable.");
        const settings = drawing.settings;
        const extension = settings.compatibilityMode ? ".excalidraw" : settings.useExcalidrawExtension ? ".excalidraw.md" : ".md";
        const moment = app.workspace.containerEl.ownerDocument.defaultView.moment;
        if (settings.drawingFilenameDateTime && typeof moment !== "function") throw new ModuleUnavailableError("project", "The drawing filename formatter is unavailable.");
        const timestamp = settings.drawingFilenameDateTime ? moment().format(settings.drawingFilenameDateTime) : "";
        await drawing.createAndOpenDrawing(`${settings.drawingFilenamePrefix}${timestamp}${extension}`, "new-tab", folder.path);
        return;
    }
    const features = app.plugins?.plugins?.["meld-encrypt"]?.enabledFeatures;
    const feature = Array.isArray(features) && features.find(item => typeof item.processCreateNewEncryptedNoteCommand === "function");
    if (!feature) throw new ModuleUnavailableError("project", "The encrypted-note creation integration is unavailable.");
    await feature.processCreateNewEncryptedNoteCommand(folder);
}
