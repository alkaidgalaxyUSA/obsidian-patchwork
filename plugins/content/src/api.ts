import type { ContentApi } from "../../contracts/content";
import { getServiceRegistry } from "../../utils/service-registry";
import { ModuleUnavailableError } from "../../utils/module-errors";
import { isMarkdownView, isEncryptedNote } from "./utils/markdown-views";
import { DocumentState } from "./editor/document-state";
import type PatchworkEditorPlugin from "./main";

export function installContentApi(plugin: PatchworkEditorPlugin, attachments: { open(): void }): void {
    const state = new DocumentState(plugin);
    const api: ContentApi = {
        version: 1,
        openDocument: request => state.open(request),
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
