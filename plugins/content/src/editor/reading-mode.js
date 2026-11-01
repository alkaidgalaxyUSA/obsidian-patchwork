import { MarkdownView, Notice } from "obsidian";

/** New document sessions start in reading mode; same-document manual toggles remain local. */
export function installReadingMode(plugin) {
    const { app } = plugin;
    const prototype = MarkdownView.prototype;
    const original = prototype.setState;
    const setState = function (state, result) {
        const openingFile = typeof state?.file === "string" && state.file !== this.file?.path;
        return original.call(this, openingFile ? { ...state, mode: "preview" } : state, result);
    };
    prototype.setState = setState;
    app.vault.setConfig("defaultViewMode", "preview");
    let disposed = false;
    app.workspace.onLayoutReady(() => {
        if (disposed) return;
        app.workspace.iterateAllLeaves((leaf) => {
            const view = leaf.view;
            if (!(view instanceof MarkdownView) || !view.file || view.getMode() === "preview") return;
            void view.setState({ ...view.getState(), mode: "preview" }, { history: false })
                .catch(() => new Notice("Could not switch this note to reading mode."));
        });
    });
    plugin.register(() => {
        disposed = true;
        if (prototype.setState === setState) prototype.setState = original;
    });
}
