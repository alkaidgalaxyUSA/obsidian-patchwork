import { NoteCodeActions } from "./note-code-actions.js";
import { formatBlock, stripLinePrefixes } from "./utils/block-formats.js";

class NoteParagraphActions extends NoteCodeActions {
    convert(context, type) {
        if (type === context.block.type) return;
        this.assertCurrent(context);
        const { view, block } = context;
        const text = this.content(context).split("\n").map(stripLinePrefixes).join("\n");
        const insert = formatBlock(type, text);
        view.dispatch({ changes: { from: block.from, to: block.to, insert }, selection: { anchor: block.from + insert.length }, userEvent: "input.paragraph-convert" });
        view.focus();
    }
}

export { NoteParagraphActions };
