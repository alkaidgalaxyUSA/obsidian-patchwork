import { Plugin } from "obsidian";
import { EditorView } from "@codemirror/view";
import { markdownViews } from "../utils/markdown-views";

/** Adds existing UI to unlocked Meld views without replacing their view or save methods. */
export class MarkdownViewAdapter {
    private elements = new Set<HTMLElement>();
    private pending = false;
    private disposed = false;

    constructor(private plugin: Plugin, private refresh: (encryptedViewClosed: boolean) => void) {
        plugin.registerEvent(plugin.app.workspace.on("layout-change", () => this.schedule()));
        plugin.registerEvent(plugin.app.workspace.on("file-open", () => this.schedule()));
        plugin.registerEvent(plugin.app.workspace.on("active-leaf-change", () => this.schedule()));
        plugin.registerEditorExtension(EditorView.updateListener.of(update => {
            if (update.docChanged && update.view.dom.closest('[data-type="meld-encrypted-view"]')) this.schedule();
        }));
        plugin.app.workspace.onLayoutReady(() => this.schedule());
        plugin.register(() => this.dispose());
    }

    private schedule(): void {
        if (this.pending || this.disposed) return;
        this.pending = true;
        queueMicrotask(() => {
            this.pending = false;
            if (this.disposed) return;
            const views = markdownViews(this.plugin.app);
            const newlyReady = views.filter(view => !this.elements.has(view.containerEl));
            const elements = new Set(views.map(view => view.containerEl));
            const encryptedViewClosed = [...this.elements].some(el =>
                el.dataset.type === "meld-encrypted-view" && !elements.has(el));
            for (const el of this.elements) if (!elements.has(el)) el.classList.remove("pw-markdown-view");
            for (const el of elements) el.classList.add("pw-markdown-view");
            this.elements = elements;
            this.refresh(encryptedViewClosed);
            for (const view of newlyReady) {
                if (view.getViewType() === "meld-encrypted-view" && view.getMode() === "preview") view.previewMode.rerender(true);
            }
        });
    }

    private dispose(): void {
        this.disposed = true;
        for (const el of this.elements) el.classList.remove("pw-markdown-view");
        this.elements.clear();
    }
}
