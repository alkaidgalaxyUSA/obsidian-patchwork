import { Notice, TFile } from "obsidian";
import { getServiceRegistry } from "../../../utils/service-registry";
import { getWindowContext, resolveWindow } from "../../../utils/windows";
import { ModuleUnavailableError } from "../../../utils/module-errors";

/** Native document opening fallback, restricted to the requested window. */
export async function openProjectDocument(app, file, context, target = "new-tab", groupLeafId, reuse = true) {
    const current = () => resolveWindow(context.windowId)?.document === context.document;
    if (!current() || app.vault.getAbstractFileByPath(file.path) !== file) throw new ModuleUnavailableError("project", "The file or document window was closed.");
    const content = getServiceRegistry(app).get("content");
    if (content && reuse) return content.openDocument({ ...context, path: file.path, target, groupLeafId, focus: true });
    const leaves = [];
    app.workspace.iterateAllLeaves(leaf => {
        if (leaf.view.containerEl.ownerDocument === context.document && leaf.view.containerEl.closest(".mod-root")) leaves.push(leaf);
    });
    let leaf = reuse && target !== "split" && leaves.find(leaf => leaf.view.file === file && (!groupLeafId || leaf.parent === leaves.find(item => item.id === groupLeafId)?.parent));
    if (!leaf) {
        const anchor = leaves.filter(leaf => leaf.parent?.children?.[leaf.parent.currentTab] === leaf)
            .sort((left, right) => (right.activeTime ?? 0) - (left.activeTime ?? 0))[0] ?? leaves[0];
        if (!anchor && context.document !== app.workspace.containerEl.ownerDocument) throw new ModuleUnavailableError("project", "This window has no native document group.");
        if (anchor) app.workspace.setActiveLeaf(anchor, { focus: false });
        leaf = app.workspace.getLeaf(target === "split" ? "split" : target === "new-tab" ? "tab" : false);
        if (leaf.view.containerEl.ownerDocument !== context.document) throw new ModuleUnavailableError("project", "The native document group belongs to another window.");
        await leaf.openFile(file);
    }
    await leaf.loadIfDeferred();
    if (!current() || !app.workspace.isAttached(leaf) || leaf.view.file !== file || leaf.view.containerEl.ownerDocument !== context.document) throw new ModuleUnavailableError("project", "The document changed while opening.");
    app.workspace.setActiveLeaf(leaf, { focus: true });
    return { leafId: leaf.id, path: file.path };
}

/** Run before native selection handlers; retain modifiers and rename-input behavior. */
export function installDocumentOpen(plugin) {
    const { app } = plugin, documents = new Map(), opening = new Map();
    let disposed = false;
    const attach = doc => {
        const doubleClick = event => {
            if (disposed || !plugin.settings.explorerOpenInNewTab || event.defaultPrevented || event.button !== 0
                || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
            const row = event.target.closest?.('.workspace-leaf-content[data-pw-module="project"][data-type="file-explorer"] .nav-file-title[data-path]');
            if (!row || row.classList.contains("is-being-renamed") || event.target.closest("input, textarea, [contenteditable=true]")) return;
            const file = app.vault.getAbstractFileByPath(row.dataset.path);
            if (!(file instanceof TFile)) return;
            event.preventDefault(); event.stopImmediatePropagation();
            const context = getWindowContext(doc), key = `${context.windowId}:${file.path}`;
            if (opening.has(key)) return;
            const content = getServiceRegistry(app).get("content");
            const snapshot = content?.getDocument(context);
            const pending = openProjectDocument(app, file, context, "new-tab", snapshot?.location?.leafId)
                .catch(error => { if (!disposed) new Notice(error.message ?? "Could not open the file."); })
                .finally(() => { if (opening.get(key) === pending) opening.delete(key); });
            opening.set(key, pending);
        };
        doc.addEventListener("dblclick", doubleClick, true);
        documents.set(doc, () => doc.removeEventListener("dblclick", doubleClick, true));
    };
    const sync = () => {
        if (disposed) return;
        const docs = new Set([app.workspace.containerEl.ownerDocument]);
        for (const leaf of app.workspace.getLeavesOfType("file-explorer")) docs.add(leaf.view.containerEl.ownerDocument);
        for (const [doc, remove] of documents) if (!docs.has(doc) || doc.defaultView?.closed) { remove(); documents.delete(doc); }
        for (const doc of docs) if (doc.defaultView && !doc.defaultView.closed && !documents.has(doc)) attach(doc);
    };
    plugin.registerEvent(app.workspace.on("layout-change", sync));
    plugin.registerEvent(app.workspace.on("window-open", sync));
    app.workspace.onLayoutReady(sync);
    plugin.register(() => { disposed = true; for (const remove of documents.values()) remove(); documents.clear(); opening.clear(); });
}
