class NoteHistory {
    constructor(plugin, editor, titles) {
        this.app = plugin.app;
        this.editor = editor;
        this.titles = titles;
        this.documents = new Map();
        plugin.registerEvent(this.app.workspace.on("layout-change", () => this.attachDocuments()));
        plugin.registerEvent(this.app.workspace.on("window-open", (_workspaceWindow, win) => this.attach(win.document)));
        this.attachDocuments();
    }

    attachDocuments() {
        if (this.disposed) return;
        for (const [doc, cleanup] of this.documents) {
            if (!doc.defaultView?.closed) continue;
            cleanup();
            this.documents.delete(doc);
        }
        this.attach(this.app.workspace.containerEl.ownerDocument);
        this.app.workspace.iterateAllLeaves((leaf) => this.attach(leaf.view.containerEl.ownerDocument));
    }

    attach(doc) {
        if (this.documents.has(doc) || this.disposed) return;
        const keydown = (event) => {
            if (event.isComposing || event.altKey || !(event.ctrlKey || event.metaKey)) return;
            const key = event.key.toLowerCase();
            if (key !== "z" && key !== "y") return;
            this.route(event, key === "y" || event.shiftKey);
        };
        const beforeinput = (event) => {
            if (["historyUndo", "historyRedo"].includes(event.inputType)) this.route(event, event.inputType === "historyRedo");
        };
        doc.defaultView.addEventListener("keydown", keydown, true);
        doc.defaultView.addEventListener("beforeinput", beforeinput, true);
        this.documents.set(doc, () => {
            doc.defaultView.removeEventListener("keydown", keydown, true);
            doc.defaultView.removeEventListener("beforeinput", beforeinput, true);
        });
    }

    route(event, redo) {
        const target = event.target?.nodeType === 1 ? event.target : event.target?.parentElement;
        if (!target) return;
        const stop = () => { event.preventDefault(); event.stopImmediatePropagation(); };
        // Composer history must never fall through into the most recent Markdown leaf.
        if (target.closest(".claudian-container")) { stop(); return; }
        const leaf = this.app.workspace.getLeavesOfType("markdown").find((leaf) => leaf.view.containerEl.contains(target));
        if (!leaf) return;
        const view = leaf.view;
        if (!target.closest(".inline-title, .cm-content, .pw-code-edge")) return;
        stop();
        this.perform(view, redo, target);
    }

    perform(view, redo, target = view?.containerEl.ownerDocument.activeElement) {
        if (!view || view.getMode() !== "source" || view.editor.cm.state.readOnly) return;
        const cm = view.editor.cm;
        const body = this.editor.bodies.get(target?.closest(".pw-note-code-body"));
        body?.forwardSelection();
        this.titles.historyView = undefined;
        const handled = (redo ? this.editor.redo : this.editor.undo)({ state: cm.state, dispatch: (transaction) => {
            if (!transaction.docChanged && transaction.effects.some((effect) => effect.is(this.titles.effect))) {
                // A title-only undo must not scroll to an unrelated saved body selection.
                cm.dispatch({ effects: transaction.effects, selection: transaction.selection,
                    annotations: transaction.annotations, filter: false });
                return;
            }
            cm.dispatch(transaction);
        } });
        if (handled && this.titles.historyView !== cm) cm.focus();
        if (!body?.destroyed) body?.sync();
    }

    dispose() {
        this.disposed = true;
        for (const cleanup of this.documents.values()) cleanup();
        this.documents.clear();
    }
}

export { NoteHistory };
