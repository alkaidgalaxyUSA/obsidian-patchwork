import { App, Editor } from "obsidian";
import { EditorView } from "@codemirror/view";
import { scanCodeBlocks } from "../editor/utils/note-code-block.js";
import { insideFence } from "../clean";
import { markdownViews } from "./markdown-views";

/** All prose entry points share this boundary, including commands and slash actions. */
export function canFormatEditor(app: App, editor: Editor): boolean {
    const cm = (editor as Editor & { cm?: EditorView }).cm;
    if (!cm || cm.state.readOnly) return false;
    if (cm.dom.closest('[data-type="meld-encrypted-view"]') &&
        !markdownViews(app).some(view => view.containerEl.contains(cm.dom))) return false;
    const doc = cm.dom.ownerDocument;
    const focused = doc.activeElement;
    if (focused?.closest(".inline-title, .pw-note-code-body, .pw-code-edge, .claudian-container")) return false;
    if (cm.dom.closest('.workspace-leaf-content[data-mode="preview"]')) return false;
    const ranges = cm.state.selection.ranges;
    const blocks = scanCodeBlocks(cm.state.doc);
    if (ranges.some(range => blocks.some(block => range.from <= block.to && range.to >= block.from))) return false;
    // Indented/list-owned fences are not ordinary code cards, but are still code.
    return !ranges.some(range => insideFence(cm.state.doc.sliceString(0, range.from)));
}
