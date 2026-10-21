const { formatCodeBlock, separateBlock } = require("./utils/code-block");

class NoteInserter {
    constructor(app, { MarkdownView, Notice }) {
        this.app = app;
        this.MarkdownView = MarkdownView;
        this.Notice = Notice;
        this.target = undefined;
    }

    remember(leaf) {
        const view = leaf?.view;
        if (!(view instanceof this.MarkdownView) || !view.file) return;
        this.target = { leaf, view, file: view.file };
    }

    getTarget() {
        const target = this.target;
        if (!target || !this.app.workspace.getLeavesOfType("markdown").includes(target.leaf)) return undefined;
        if (target.leaf.view !== target.view || target.view.file !== target.file) return undefined;
        if (this.app.vault.getAbstractFileByPath(target.file.path) !== target.file) return undefined;
        return target;
    }

    describeTarget() {
        const target = this.getTarget();
        return target ? `Target note: ${target.file.path}` : "Open a note in editing mode and place the cursor first.";
    }

    insert(block, mode = "auto") {
        const target = this.getTarget();
        if (!target) {
            new this.Notice("Open the target note and place the cursor before clicking Insert into note.");
            return;
        }
        if (target.view.getMode() !== "source") {
            new this.Notice(`Switch "${target.file.basename}" to editing mode and place the cursor first.`);
            return;
        }
        if (!block?.text) {
            new this.Notice("This code block is empty. Nothing was inserted.");
            return;
        }

        let inserted = false;
        try {
            const editor = target.view.editor;
            if (editor.listSelections().length > 1) {
                new this.Notice("Keep only one cursor in the target note before inserting content.");
                return;
            }
            const cursor = editor.getCursor("head");
            const offset = editor.posToOffset(cursor);
            const content = editor.getValue();
            const formatted = formatCodeBlock(block, mode);
            const text = formatted.fenced
                ? separateBlock(formatted.text, content.slice(0, offset), content.slice(offset))
                : formatted.text;

            // Insert at the cursor without replacing the user's selected text.
            editor.replaceRange(text, cursor);
            inserted = true;
            editor.setCursor(editor.offsetToPos(offset + text.length));
            this.app.workspace.setActiveLeaf(target.leaf, { focus: true });
            editor.focus();
            new this.Notice(`Inserted into "${target.file.basename}". You can undo this in the note.`);
        } catch (error) {
            console.error("Claudian Note Actions: insertion failed", error);
            new this.Notice(inserted
                ? "Content was inserted, but the cursor could not be positioned. Check the note before inserting again."
                : "Insertion failed. Check that the target note is still in editing mode.");
        }
    }
}

module.exports = { NoteInserter };
