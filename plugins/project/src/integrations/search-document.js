/** Read-only optional view adapters; decrypted search text never enters an index. */
export async function readSearchDocument(app, file, view) {
    if (["mdenc", "encrypted"].includes(file.extension)) {
        if (view?.getViewType() !== "meld-encrypted-view" || view.isUnlocking || !view.isSavingEnabled
            || typeof view.getUnencryptedViewData !== "function") return { kind: "locked" };
        return { kind: "text", text: view.getUnencryptedViewData() };
    }
    const type = app.viewRegistry?.typeByExtension?.[file.extension];
    if (!["md", "canvas", "txt"].includes(file.extension) && type !== "code-editor") return { kind: "unsupported" };
    if (file.stat.size > 5 * 1024 * 1024) return { kind: "skipped" };
    return { kind: "text", text: view?.getViewData?.() ?? await app.vault.cachedRead(file) };
}
