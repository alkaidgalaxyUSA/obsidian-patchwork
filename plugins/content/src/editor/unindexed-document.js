import { FileSystemAdapter, ItemView, normalizePath } from "obsidian";
import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { scopeModule } from "../../../utils/module-scope";
import { getWindowContext, resolveWindow } from "../../../utils/windows";

export const UNINDEXED_DOCUMENT_VIEW = "patchwork-unindexed-document";

/** Read-only source viewing for files excluded from Obsidian's index. */
export class UnindexedDocumentView extends ItemView {
    getViewType() { return UNINDEXED_DOCUMENT_VIEW; }
    getDisplayText() { return this.path?.split("/").pop() ?? "Source"; }
    getIcon() { return "file-text"; }
    getState() { return { path: this.path }; }

    async onOpen() {
        this.scope = scopeModule(this.contentEl, "content", { surface: "source-preview" });
        this.register(() => this.scope.dispose());
    }

    async setState(state, result) {
        const revision = this.revision = (this.revision ?? 0) + 1;
        const context = getWindowContext(this.contentEl.ownerDocument);
        const current = () => this.revision === revision && resolveWindow(context.windowId)?.document === context.document;
        const path = state.path;
        const adapter = this.app.vault.adapter;
        if (!(adapter instanceof FileSystemAdapter) || typeof path !== "string" || !path || isAbsolute(path)
            || path.split(/[\\/]/).includes("..") || /\.mdenc$/i.test(path)) throw new Error("This source file cannot be previewed.");
        const root = await realpath(adapter.getBasePath());
        const absolute = await realpath(resolve(root, path));
        const inside = relative(root, absolute);
        if (isAbsolute(inside) || inside === ".." || inside.startsWith("../") || inside.startsWith(`..\\`)) throw new Error("The source is outside the vault.");
        const info = await stat(absolute);
        if (!info.isFile() || info.size > 2 * 1024 * 1024) throw new Error("Source preview supports text files up to 2 MB.");
        const bytes = await adapter.readBinary(normalizePath(path));
        const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        if (text.includes("\0")) throw new Error("Binary files cannot be previewed as text.");
        if (!current()) throw new Error("The source window was closed or changed.");
        this.path = normalizePath(path);
        this.contentEl.empty();
        this.contentEl.createEl("p", { text: "Read-only source preview", cls: "pw-source-preview-label" });
        this.contentEl.createEl("pre", { text, cls: "pw-source-preview-text" });
        await super.setState(state, result);
    }

    async onClose() { this.revision = (this.revision ?? 0) + 1; }
}

export async function openUnindexedDocument(state, request) {
    state.context(request);
    const app = state.app;
    const leaves = state.leaves().filter(leaf => leaf.view.containerEl.ownerDocument === request.document);
    const group = request.groupLeafId && leaves.find(leaf => state.id(leaf) === request.groupLeafId)?.parent;
    if (request.groupLeafId && !group) throw new Error("The document group was closed. Open the menu again.");
    let leaf = app.workspace.getLeavesOfType(UNINDEXED_DOCUMENT_VIEW).find(leaf => leaf.view.path === request.path
        && leaf.view.containerEl.ownerDocument === request.document && (!group || leaf.parent === group));
    if (!leaf) {
        const anchor = group?.children[group.currentTab] ?? state.records.get(request.windowId)?.leaf;
        if (anchor) app.workspace.setActiveLeaf(anchor, { focus: false });
        else if (request.document !== app.workspace.containerEl.ownerDocument) throw new Error("This window has no document group.");
        leaf = app.workspace.getLeaf(request.target === "split" ? "split" : "tab");
        if (leaf.view.containerEl.ownerDocument !== request.document) throw new Error("The requested document window is unavailable.");
        try { await leaf.setViewState({ type: UNINDEXED_DOCUMENT_VIEW, active: true, state: { path: request.path } }); }
        catch (error) { leaf.detach(); throw error; }
    }
    state.context(request);
    if (!app.workspace.isAttached(leaf) || leaf.view.path !== request.path || leaf.view.containerEl.ownerDocument !== request.document) {
        throw new Error("The source document changed while opening.");
    }
    app.workspace.setActiveLeaf(leaf, { focus: request.focus !== false });
    return { leafId: state.id(leaf), path: request.path };
}
