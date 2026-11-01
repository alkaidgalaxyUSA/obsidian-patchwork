import { MarkdownView, Notice } from "obsidian";
import type { App, TFile, WorkspaceLeaf } from "obsidian";
import type { CodeBlock, InsertMode } from "./types";
import { formatCodeBlock, separateBlock } from "./utils/code-block";
import { contentService } from "./integrations/content";
import { getWindowContext } from "../../utils/windows";

export class NoteInserter {
    private targets = new Map<Document, { leaf: WorkspaceLeaf; view: MarkdownView; file: TFile }>();

    constructor(private readonly app: App) {}

    remember(leaf: WorkspaceLeaf | null) {
        const view = leaf?.view;
        if (!leaf || !(view instanceof MarkdownView) || !view.file) return;
        this.targets.set(view.containerEl.ownerDocument, { leaf, view, file: view.file });
    }

    forget(doc: Document): void { this.targets.delete(doc); }

    dispose(): void { this.targets.clear(); }

    getTarget(doc = this.app.workspace.containerEl.ownerDocument) {
        for (const document of this.targets.keys()) if (!document.defaultView || document.defaultView.closed) this.targets.delete(document);
        const target = this.targets.get(doc);
        if (!target || !this.app.workspace.getLeavesOfType("markdown").includes(target.leaf)) return undefined;
        if (target.leaf.view !== target.view || target.view.file !== target.file) return undefined;
        if (this.app.vault.getAbstractFileByPath(target.file.path) !== target.file) return undefined;
        return target;
    }

    describeTarget(doc?: Document) {
        const target = this.getTarget(doc);
        return target ? `Target note: ${target.file.path}` : "Open a note in editing mode and place the cursor first.";
    }

    async insert(block: CodeBlock, mode: InsertMode = "auto", doc?: Document) {
        const target = this.getTarget(doc);
        if (!target) {
            new Notice("Open the target note and place the cursor before clicking Insert into note.");
            return;
        }
        if (target.view.getMode() !== "source") {
            new Notice(`Switch "${target.file.basename}" to editing mode and place the cursor first.`);
            return;
        }
        if (!block?.text) {
            new Notice("This code block is empty. Nothing was inserted.");
            return;
        }

        let inserted = false;
        try {
            const editor = target.view.editor;
            if (editor.listSelections().length > 1) {
                new Notice("Keep only one cursor in the target note before inserting content.");
                return;
            }
            const cursor = editor.getCursor("head");
            const offset = editor.posToOffset(cursor);
            const content = editor.getValue();
            const formatted = formatCodeBlock(block, mode);
            const text = formatted.fenced
                ? separateBlock(formatted.text, content.slice(0, offset), content.slice(offset))
                : formatted.text;

            const contentApi = contentService(this.app);
            const leafId = (target.leaf as WorkspaceLeaf & { id?: string }).id;
            if (contentApi && leafId) {
                await contentApi.insert({ ...getWindowContext(target.view.containerEl.ownerDocument),
                    target: { leafId, path: target.file.path }, text, mode: "raw" });
                new Notice(`Inserted into "${target.file.basename}". You can undo this in the note.`);
                return;
            }

            // Insert at the cursor without replacing the user's selected text.
            editor.replaceRange(text, cursor);
            inserted = true;
            editor.setCursor(editor.offsetToPos(offset + text.length));
            this.app.workspace.setActiveLeaf(target.leaf, { focus: true });
            editor.focus();
            new Notice(`Inserted into "${target.file.basename}". You can undo this in the note.`);
        } catch (error) {
            console.error("Claudian Extension: insertion failed", error);
            new Notice(inserted
                ? "Content was inserted, but the cursor could not be positioned. Check the note before inserting again."
                : "Insertion failed. Check that the target note is still in editing mode.");
        }
    }
}

