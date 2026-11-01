import type { Plugin } from "obsidian";
import { EditorView } from "@codemirror/view";
import { redo, undo } from "@codemirror/commands";

/** Keep chat history shortcuts inside the invoking upstream composer. */
export function installComposerHistory(plugin: Plugin): void {
    const documents = new Map<Document, () => void>();
    let disposed = false;
    const attach = (doc: Document) => {
        const win = doc.defaultView;
        if (disposed || !win || documents.has(doc)) return;
        const route = (event: Event, forward: boolean) => {
            const node = event.target as Node | null;
            const target = node?.nodeType === 1 ? node as HTMLElement : node?.parentElement;
            if (!target?.closest(".claudian-container")) return;
            const composer = target.closest(".claudian-input");
            const editor = composer && EditorView.findFromDOM(target);
            event.stopImmediatePropagation();
            if (editor) { event.preventDefault(); (forward ? redo : undo)(editor); }
            else if (!target.closest("input, textarea, [contenteditable='true']")) event.preventDefault();
        };
        const keydown = (event: KeyboardEvent) => {
            if (event.isComposing || event.altKey || !(event.ctrlKey || event.metaKey)) return;
            const key = event.key.toLowerCase();
            if (key === "z" || key === "y") route(event, key === "y" || event.shiftKey);
        };
        const beforeinput = (event: InputEvent) => {
            if (["historyUndo", "historyRedo"].includes(event.inputType)) route(event, event.inputType === "historyRedo");
        };
        const detach = () => { win.removeEventListener("keydown", keydown, true); win.removeEventListener("beforeinput", beforeinput, true); win.removeEventListener("unload", detach); documents.delete(doc); };
        win.addEventListener("keydown", keydown, true);
        win.addEventListener("beforeinput", beforeinput, true);
        win.addEventListener("unload", detach, { once: true });
        documents.set(doc, detach);
    };
    const sync = () => { attach(plugin.app.workspace.containerEl.ownerDocument); plugin.app.workspace.iterateAllLeaves(leaf => attach(leaf.view.containerEl.ownerDocument)); };
    plugin.registerEvent(plugin.app.workspace.on("layout-change", sync));
    plugin.registerEvent(plugin.app.workspace.on("window-open", (_window, win) => attach(win.document)));
    plugin.register(() => { disposed = true; for (const detach of documents.values()) detach(); });
    sync();
}
