import { Compartment, EditorState, StateEffect } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { documentFileInfo, setDocumentReadOnly } from "./utils/document-file-info";

/** Synchronize disk permissions with every open editor of the same file. */
export class DocumentFileLock {
    constructor(plugin, changed) {
        this.plugin = plugin;
        this.app = plugin.app;
        this.changed = changed;
        this.info = new Map();
        this.pending = new Set();
        this.editors = new Map();
        this.views = new Set();
    }

    isLocked(file) { return !!file && (this.pending.has(file.path) || this.info.get(file.path)?.readOnly === true); }

    editor(view) { return view.editorView ?? view.editor?.cm ?? view.sourceMode?.cmEditor?.cm; }

    extensions(view) {
        if (!this.isLocked(view.file)) return [];
        return [EditorState.readOnly.of(true), EditorView.editable.of(false),
            EditorState.changeFilter.of(() => !this.isLocked(view.file))];
    }

    sync(views) {
        this.views = new Set(views);
        const current = new Set();
        for (const view of views) {
            const locked = this.isLocked(view.file);
            view.containerEl.classList.toggle("pw-file-readonly", locked);
            const editor = this.editor(view);
            if (!editor?.dispatch || !editor.state || editor.destroyed) continue;
            current.add(editor);
            let record = this.editors.get(editor);
            if (!record) {
                record = { compartment: new Compartment(), listener: new Compartment(), view };
                this.editors.set(editor, record);
                editor.dispatch({ effects: StateEffect.appendConfig.of([
                    record.compartment.of([]), record.listener.of(EditorView.updateListener.of(update => {
                        if (update.selectionSet || update.docChanged) this.changed();
                    })),
                ]) });
            }
            if (record.locked === locked && record.path === view.file?.path) continue;
            record.locked = locked;
            record.path = view.file?.path;
            editor.dispatch({ effects: record.compartment.reconfigure(this.extensions(view)) });
        }
        for (const [editor, record] of this.editors) {
            if (current.has(editor)) continue;
            this.release(editor, record);
            this.editors.delete(editor);
        }
    }

    async refresh(views) {
        if (this.refreshing || this.disposed) return;
        this.refreshing = true;
        try {
            const files = new Map(views.filter(view => view.file).map(view => [view.file.path, view.file]));
            await Promise.all([...files.keys()].map(async path => {
                try {
                    const info = await documentFileInfo(this.app.vault.adapter.getFullPath(path), this.info.get(path));
                    if (!this.disposed) this.info.set(path, info);
                } catch { if (!this.disposed) this.info.delete(path); }
            }));
            for (const path of this.info.keys()) if (!files.has(path)) this.info.delete(path);
        } finally { this.refreshing = false; }
    }

    async flush(view, file) {
        const deadline = Date.now() + 15000;
        const wait = async () => {
            if (Date.now() >= deadline) throw new Error("Saving timed out. The file was not locked.");
            await new Promise(resolve => setTimeout(resolve, 25));
        };
        const saving = () => view.saving || view.isSavingInProgress || this.plugin.noteTitle?.records.get(file)?.running;
        while (saving()) await wait();
        if (view.file !== file) throw new Error("The open document changed. Please try again.");
        await view.save?.();
        while (saving()) await wait();
        if (view.dirty || view.saveAgain || view.dataWasChangedSinceLastSave) throw new Error("Save the document before locking it.");
    }

    async toggle(file) {
        if (!file || this.pending.has(file.path)) return;
        const path = file.path;
        const fullPath = this.app.vault.adapter.getFullPath(path);
        const before = await documentFileInfo(fullPath, this.info.get(path));
        if (this.disposed || this.pending.has(path)) return;
        this.pending.add(path);
        this.sync([...this.views]);
        this.changed();
        try {
            if (!before.readOnly) {
                for (const view of this.views) if (view.file === file) await this.flush(view, file);
            }
            if (this.disposed) return;
            if (file.path !== path) throw new Error("The file was renamed. Please try again.");
            await setDocumentReadOnly(fullPath, !before.readOnly);
            this.info.set(path, await documentFileInfo(fullPath));
        } finally {
            this.pending.delete(path);
            if (!this.disposed) { this.sync([...this.views]); this.changed(); }
        }
    }

    release(editor, record) {
        if (editor.destroyed) return;
        try { editor.dispatch({ effects: [record.compartment.reconfigure([]), record.listener.reconfigure([])] }); }
        catch { /* A closing view may already have discarded its editor state. */ }
    }

    dispose() {
        this.disposed = true;
        for (const [editor, record] of this.editors) this.release(editor, record);
        for (const view of this.views) view.containerEl.classList.remove("pw-file-readonly");
        this.editors.clear();
        this.views.clear();
        this.info.clear();
    }
}
