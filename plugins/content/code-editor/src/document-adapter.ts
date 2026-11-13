import type { Plugin, WorkspaceLeaf } from "obsidian";
import { EditorSelection } from "@codemirror/state";
import type { CodeDocumentAdapter } from "../../../contracts/code-document";
import type { CallContext, WindowContext } from "../../../contracts/common";
import type { DocumentSnapshot } from "../../../contracts/content";
import { getServiceRegistry } from "../../../utils/service-registry";
import { getWindowContext, resolveWindow } from "../../../utils/windows";
import { ModuleUnavailableError } from "../../../utils/module-errors";
import { CodeEditorView, CODE_EDITOR_VIEW_TYPE } from "./view";

type CodeLeaf = WorkspaceLeaf & { id: string; view: CodeEditorView };

export function installCodeDocumentAdapter(plugin: Plugin): () => void {
    let disposed = false;
    const lineEndings = new WeakMap<object, "LF" | "CRLF">();
    const listeners = new Set<(snapshot: DocumentSnapshot) => void>();
    const find = (leafId: string, context: WindowContext) => plugin.app.workspace.getLeavesOfType(CODE_EDITOR_VIEW_TYPE)
        .find(leaf => (leaf as CodeLeaf).id === leafId && leaf.view.containerEl.ownerDocument === context.document && leaf.view instanceof CodeEditorView) as CodeLeaf | undefined;
    const requireView = (leafId: string, context: CallContext, path?: string) => {
        context.signal?.throwIfAborted();
        const leaf = find(leafId, context);
        if (disposed || resolveWindow(context.windowId)?.document !== context.document || !leaf || !leaf.view.file
            || path !== undefined && leaf.view.file.path !== path) throw new ModuleUnavailableError("codeDocument", "The code document changed or its window was closed.");
        return { leaf, view: leaf.view as CodeEditorView };
    };
    const api: CodeDocumentAdapter = {
        version: 1,
        async save(location, context) {
            const { view } = requireView(location.leafId, context, location.path);
            if (view.documentReadOnly) return;
            await view.save();
            requireView(location.leafId, context, location.path);
        },
        supports: (id, context) => !disposed && resolveWindow(context.windowId)?.document === context.document && !!find(id, context),
        getSnapshot(id, context) {
            const { view } = requireView(id, context);
            const editor = view.getDocumentEditor();
            const selection = editor?.state.selection.main;
            const line = selection && editor?.state.doc.lineAt(selection.head);
            const doc = editor?.state.doc;
            if (doc && !lineEndings.has(doc)) lineEndings.set(doc, view.getViewData().includes("\r\n") ? "CRLF" : "LF");
            return { windowId: context.windowId, location: { leafId: id, path: view.file!.path }, displayPath: view.file!.path,
                cursor: line && selection ? { line: line.number - 1, column: Array.from(line.text.slice(0, selection.head - line.from)).length } : undefined,
                scrollTop: editor?.scrollDOM.scrollTop, lineEnding: doc ? lineEndings.get(doc) : undefined, mode: "code", readOnly: view.documentReadOnly,
                canToggleReadOnly: false, activeHeadingTrail: [] };
        },
        async navigate(location, context) {
            const { leaf, view } = requireView(location.leafId, context, location.path);
            const editor = view.getDocumentEditor();
            if (!editor) throw new ModuleUnavailableError("codeDocument", "The code editor is not ready.");
            const line = editor.state.doc.line(Math.max(1, Math.min(editor.state.doc.lines, (location.line ?? 0) + 1)));
            const anchor = Math.min(line.to, line.from + Array.from(line.text).slice(0, Math.max(0, location.column ?? 0)).join("").length);
            editor.dispatch({ selection: EditorSelection.cursor(anchor), scrollIntoView: true });
            if (Number.isFinite(location.scrollTop)) editor.scrollDOM.scrollTop = Math.max(0, location.scrollTop!);
            plugin.app.workspace.setActiveLeaf(leaf, { focus: true }); editor.focus();
        },
        getSelection(id, context) {
            const { view } = requireView(id, context);
            const editor = view.getDocumentEditor();
            if (!editor) return undefined;
            const selection = editor.state.selection.main;
            const selectedText = editor.state.doc.sliceString(selection.from, selection.to);
            return { windowId: context.windowId, location: { leafId: id, path: view.file!.path }, selectedText,
                lineCount: selectedText ? selectedText.split(/\r?\n/).length : 0, startLine: editor.state.doc.lineAt(selection.from).number - 1 };
        },
        async insert(location, text, context) {
            const { view } = requireView(location.leafId, context, location.path);
            const editor = view.getDocumentEditor();
            if (!editor || view.documentReadOnly) throw new ModuleUnavailableError("codeDocument", "The code document is not editable.");
            editor.dispatch(editor.state.replaceSelection(text)); await view.save();
            requireView(location.leafId, context, location.path);
        },
        setReadOnly(location, value, context) { requireView(location.leafId, context, location.path).view.setDocumentReadOnly(value); },
        onChange(listener) { if (!disposed) listeners.add(listener); return () => listeners.delete(listener); },
    };
    const publish = () => {
        if (disposed) return;
        for (const leaf of plugin.app.workspace.getLeavesOfType(CODE_EDITOR_VIEW_TYPE)) {
            if (!(leaf.view instanceof CodeEditorView) || !leaf.view.file) continue;
            try {
                const snapshot = api.getSnapshot((leaf as CodeLeaf).id, getWindowContext(leaf.view.containerEl.ownerDocument));
                for (const listener of [...listeners]) {
                    try { listener(structuredClone(snapshot)); } catch (error) { console.error("Code document subscriber failed.", error); }
                }
            } catch { /* Deferred/closing code views are unavailable. */ }
        }
    };
    const registration = getServiceRegistry(plugin.app).register("content", "codeDocument", api);
    plugin.registerEvent(plugin.app.workspace.on("layout-change", publish));
    plugin.registerEvent(plugin.app.workspace.on("file-open", publish));
    plugin.register(() => { disposed = true; registration.dispose(); listeners.clear(); });
    return publish;
}
