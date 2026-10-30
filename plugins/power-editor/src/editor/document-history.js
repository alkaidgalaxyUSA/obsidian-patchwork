/** Remember visited file positions without reading or changing document contents. */
export class DocumentHistory {
    constructor(plugin) {
        this.app = plugin.app;
        this.locations = [];
        this.previous = this.app.workspace.activeLeaf;
        const capture = () => this.record(this.app.workspace.activeLeaf);
        plugin.registerEvent(this.app.workspace.on("active-leaf-change", leaf => {
            this.record(this.previous);
            this.previous = leaf;
            this.record(leaf);
        }));
        plugin.registerEvent(this.app.workspace.on("file-open", capture));
        plugin.registerEvent(this.app.workspace.on("patchwork:document-tab-activated", leaf => this.record(leaf)));
        const schedule = event => {
            if (!event.target.closest?.(".mod-root .workspace-leaf-content")) return;
            clearTimeout(this.timer);
            this.timer = setTimeout(capture, 250);
        };
        const docs = new Set();
        const attach = () => {
            const current = new Set([this.app.workspace.containerEl.ownerDocument]);
            this.app.workspace.iterateAllLeaves(leaf => { current.add(leaf.view.containerEl.ownerDocument); });
            for (const doc of current) {
                if (docs.has(doc)) continue;
                docs.add(doc);
                for (const type of ["keyup", "pointerup", "scroll"]) plugin.registerDomEvent(doc, type, schedule, true);
            }
        };
        attach();
        plugin.registerEvent(this.app.workspace.on("window-open", attach));
        this.app.workspace.iterateAllLeaves(leaf => { this.record(leaf); });
        capture();
        plugin.register(() => { clearTimeout(this.timer); this.locations.length = 0; docs.clear(); });
    }

    record(leaf) {
        const view = leaf?.view;
        if (!view?.file || !view.containerEl.closest(".mod-root") || !this.app.workspace.isAttached(leaf)) return;
        const code = view.editorView;
        const codeOffset = code?.state.selection.main.head;
        const cursor = view.editor?.getCursor?.();
        const line = code ? code.state.doc.lineAt(codeOffset).number : cursor ? cursor.line + 1 : undefined;
        const item = { path: view.file.path, label: view.file.name, line,
            state: structuredClone(leaf.getViewState()), ephemeral: structuredClone(leaf.getEphemeralState()),
            codeOffset, codeScrollTop: code?.scrollDOM.scrollTop };
        item.key = JSON.stringify([item.path, item.state.state?.mode, item.ephemeral, codeOffset, item.codeScrollTop]);
        this.locations = [item, ...this.locations.filter(previous => previous.key !== item.key)].slice(0, 80);
    }
}
