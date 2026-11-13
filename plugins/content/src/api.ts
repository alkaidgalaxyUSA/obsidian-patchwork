import type { ContentApi } from "../../contracts/content";
import { getServiceRegistry } from "../../utils/service-registry";
import { ModuleUnavailableError } from "../../utils/module-errors";
import { isMarkdownView, isEncryptedNote } from "./utils/markdown-views";
import { DocumentState } from "./editor/document-state";
import { UNINDEXED_DOCUMENT_VIEW, UnindexedDocumentView } from "./editor/unindexed-document";
import type PatchworkEditorPlugin from "./main";
import { getWindowContext } from "../../utils/windows";

export function installContentApi(plugin: PatchworkEditorPlugin, attachments: { open(): void }): void {
    plugin.registerView(UNINDEXED_DOCUMENT_VIEW, leaf => new UnindexedDocumentView(leaf));
    const state = new DocumentState(plugin);
    const api: ContentApi = {
        version: 1,
        openDocument: request => state.open(request),
        saveDocuments: async (paths, context) => {
            state.context(context);
            const selected = new Set(paths);
            const targets = state.leaves().filter(leaf => selected.has(leaf.view.file?.path))
                .map(leaf => ({ leaf, path: leaf.view.file.path, view: leaf.view, context: { ...getWindowContext(leaf.view.containerEl.ownerDocument), signal: context.signal } }));
            for (const target of targets) {
                state.context(context);
                const location = { leafId: state.id(target.leaf), path: target.path };
                state.leaf(location, target.context);
                if (isEncryptedNote(target.view.file)) throw new ModuleUnavailableError("content", "Save and close the encrypted document before committing it. Its encryption provider owns saving.");
                if (state.locks.isLocked(target.view.file)) continue;
                if (isMarkdownView(target.view)) await target.view.save();
                else if (state.code?.supports(location.leafId, target.context)) {
                    if (!state.code.save) throw new ModuleUnavailableError("codeDocument", "Reload Code Editor to enable saving before commit.");
                    await state.code.save(location, target.context);
                }
                state.leaf(location, target.context);
            }
            state.context(context);
        },
        getDocument: context => { state.context(context); return state.snapshot(context); },
        onDocument: listener => state.subscribe(state.listeners, listener),
        getHeadings: async (location, context) => {
            const leaf = state.leaf(location, context);
            if (!isMarkdownView(leaf.view)) throw new ModuleUnavailableError("content", "This view does not provide document headings.");
            return state.headingTree(leaf);
        },
        navigate: (location, context) => state.navigate(location, context),
        setEncoding: (location, context, encoding) => state.encodings.convert(location, context, encoding),
        toggleReadOnly: async (location, context) => {
            const leaf = state.leaf(location, context);
            if (!leaf.view.file || !state.locks.info.has(leaf.view.file.path)
                || !("getFullPath" in plugin.app.vault.adapter) || typeof plugin.app.vault.adapter.getFullPath !== "function"
                || !isMarkdownView(leaf.view) && leaf.view.getViewType() !== "code-editor") {
                throw new ModuleUnavailableError("content", "This document does not support changing file attributes.");
            }
            await state.locks.toggle(leaf.view.file);
        },
        insert: async request => {
            state.context(request);
            const location = request.target ?? state.snapshot(request).location;
            if (!location) throw new ModuleUnavailableError("content", "Open a Markdown document before inserting text.");
            const leaf = state.leaf(location, request);
            if (state.code?.supports(location.leafId, request)) {
                if (request.mode === "fenced") throw new ModuleUnavailableError("content", "Fenced insertion requires a Markdown document.");
                await state.code.insert(location, request.text, request); return;
            }
            const view = leaf.view;
            if (!isMarkdownView(view) || !view.file || isEncryptedNote(view.file) || state.locks.isLocked(view.file)) {
                throw new ModuleUnavailableError("content", "Insert is available only in an editable plain Markdown document.");
            }
            const editor = view.editor;
            const fenced = request.mode === "fenced" || request.mode === "auto" && !!request.language;
            const longest = Math.max(2, ...[...request.text.matchAll(/`+/g)].map(match => match[0].length));
            const fence = "`".repeat(longest + 1);
            const text = fenced ? `${fence}${(request.language ?? "").replace(/[\r\n`]/g, "")}\n${request.text}\n${fence}` : request.text;
            if (view.getMode() !== "source") throw new ModuleUnavailableError("content", "Switch the document to editing mode before inserting text.");
            const point = editor.getCursor("head");
            const offset = editor.posToOffset(point);
            editor.replaceRange(text, point);
            editor.setCursor(editor.offsetToPos(offset + text.length));
            plugin.app.workspace.setActiveLeaf(leaf, { focus: true }); editor.focus();
            await view.save();
            state.schedule();
        },
        getSelection: context => { state.context(context); return state.selection(context); },
        onSelection: listener => state.subscribe(state.selectionListeners, listener, true),
        reviewUnreferencedImages: async context => {
            state.context(context);
            if (context.document !== plugin.app.workspace.containerEl.ownerDocument) throw new ModuleUnavailableError("content", "Attachment review is available in the main window.");
            attachments.open();
        },
    };
    const registration = getServiceRegistry(plugin.app).register("content", "content", api);
    plugin.register(() => { registration.dispose(); state.dispose(); });
}
