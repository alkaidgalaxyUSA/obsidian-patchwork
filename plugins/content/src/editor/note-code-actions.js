import { updateOpening } from "./utils/note-code-block.js";
import { formatBlock } from "./utils/block-formats.js";

class NoteCodeActions {
    constructor(controller) {
        this.controller = controller;
        this.handlers = new Map([
            ["copy", (context) => this.copy(context)],
            ["cut", (context) => this.cut(context)],
            ["delete", (context) => this.remove(context)],
            ["turn-into", (context, type) => this.convert(context, type)],
            ["indent", (context, direction) => this.indent(context, direction)],
            ["copy-link", (context) => this.copyLink(context)],
            ["add-below", (context, type) => this.addBelow(context, type)],
        ]);
    }

    async run(view, header, action, value) {
        const block = this.controller.bindings.get(header)?.getBlock();
        const handler = this.handlers.get(action);
        if (!block || !handler) return;
        if (view.state.readOnly && action !== "copy") {
            new this.controller.Notice("This note is read-only.");
            return;
        }
        const context = { view, block, doc: view.state.doc, document: header.ownerDocument };
        try { await handler(context, value); }
        catch (error) { new this.controller.Notice(error.message || "The code block action failed."); }
    }

    content({ doc, block }) { return doc.sliceString(block.contentFrom, block.contentTo); }

    assertCurrent({ view, doc }) {
        if (view.state.readOnly || view.state.doc !== doc) throw new Error("The note changed. Try the action again.");
    }

    async writeClipboard(context, text) {
        await context.document.defaultView.navigator.clipboard.writeText(text);
    }

    async copy(context) {
        await this.writeClipboard(context, this.content(context));
        this.controller.menus.showCopied(context.document);
    }

    async cut(context) {
        // Never remove content before the clipboard write succeeds, or after an intervening edit.
        await this.writeClipboard(context, this.content(context));
        this.remove(context);
        this.controller.menus.showCopied(context.document);
    }

    blockEnd({ doc, block }) {
        const suffix = doc.sliceString(block.to, Math.min(doc.length, block.to + 150));
        const reference = suffix.match(/^\n(?:\n)?\^[\w-]+[ \t]*(?=\n|$)/);
        return block.to + (reference?.[0].length ?? 0);
    }

    remove(context) {
        this.assertCurrent(context);
        const { view, doc, block } = context;
        const end = Math.min(doc.length, this.blockEnd(context) + 1);
        view.dispatch({ changes: { from: block.from, to: end }, selection: { anchor: block.from }, userEvent: "delete.code-block" });
        view.focus();
    }

    convert(context, type) {
        if (type === "code") return;
        this.assertCurrent(context);
        const { view, block } = context;
        const insert = formatBlock(type, this.content(context), block.options);
        view.dispatch({ changes: { from: block.from, to: block.to, insert }, selection: { anchor: block.from + insert.length }, userEvent: "input.code-convert" });
        view.focus();
    }

    indent(context, direction) {
        this.assertCurrent(context);
        const { view, block } = context;
        const offset = Math.max(0, Math.min(6, block.options.offset + direction));
        if (offset === block.options.offset) return;
        view.dispatch({ changes: { from: block.from, to: block.openTo, insert: updateOpening(block, "offset", offset) }, userEvent: "input.code-indent" });
    }

    async copyLink(context) {
        const { view, doc, block } = context;
        let file;
        this.controller.app.workspace.iterateAllLeaves((leaf) => {
            if (leaf.view.editor?.cm === view) file = leaf.view.file;
        });
        if (!file) throw new Error("Cannot find the note containing this code block.");
        const suffix = doc.sliceString(block.to, this.blockEnd(context));
        const existing = suffix.match(/\^([\w-]+)[ \t]*$/)?.[1];
        const id = existing ?? `pw-${context.document.defaultView.crypto.randomUUID().slice(0, 8)}`;
        const vault = encodeURIComponent(this.controller.app.vault.getName());
        const target = encodeURIComponent(`${file.path}#^${id}`);
        const link = `obsidian://open?vault=${vault}&file=${target}`;
        await this.writeClipboard(context, link);
        this.assertCurrent(context);
        if (!existing) {
            const closing = block.fence && block.closeFrom === undefined ? `\n${block.prefix}${block.fence}` : "";
            view.dispatch({ changes: { from: block.to, insert: `${closing}\n\n^${id}\n` }, userEvent: "input.code-link" });
        }
        this.controller.menus.showCopied(context.document);
    }

    addBelow(context, type) {
        this.assertCurrent(context);
        const { view, doc, block } = context;
        const end = this.blockEnd(context);
        const closing = block.fence && block.closeFrom === undefined ? `\n${block.prefix}${block.fence}` : "";
        const content = formatBlock(type, "");
        const prefix = `${closing}\n\n`;
        const insert = `${prefix}${content}${end < doc.length ? "\n\n" : "\n"}`;
        const start = end + prefix.length;
        const anchor = ["code", "formula", "text-diagram"].includes(type) ? start + content.indexOf("\n") + 1
            : type === "table" ? start + 2 : start + content.length;
        view.dispatch({ changes: { from: end, insert }, selection: { anchor }, scrollIntoView: true, userEvent: "input.code-add-below" });
        view.focus();
    }
}

export { NoteCodeActions };
