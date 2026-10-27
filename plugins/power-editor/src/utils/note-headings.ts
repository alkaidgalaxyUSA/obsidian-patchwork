import { App, HeadingCache, TFile } from "obsidian";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { isEncryptedNote, unlockedNoteView } from "./markdown-views";

/** Decrypted headings stay local to the open view, never in Obsidian's file index. */
export function noteHeadings(app: App, file: TFile): HeadingCache[] {
    if (!isEncryptedNote(file)) return app.metadataCache.getFileCache(file)?.headings ?? [];
    const view = unlockedNoteView(app, file);
    const cm = (view?.editor as { cm?: EditorView } | undefined)?.cm;
    if (!cm) return [];
    const headings = new Map<number, HeadingCache>();
    const tree = ensureSyntaxTree(cm.state, cm.state.doc.length, 50) ?? syntaxTree(cm.state);
    tree.iterate({ enter(node) {
        const match = /(?:^|_)HyperMD-header-([1-6])(?:_|$)/.exec(node.name);
        if (!match) return;
        const line = cm.state.doc.lineAt(node.from);
        if (headings.has(line.number)) return;
        const heading = line.text.replace(/^\s{0,3}#{1,6}(?:\s+|$)/, "").replace(/\s+#+\s*$/, "").trim();
        headings.set(line.number, { heading, level: Number(match[1]), position: {
            start: { line: line.number - 1, col: 0, offset: line.from },
            end: { line: line.number - 1, col: line.length, offset: line.to },
        } });
    } });
    return [...headings.values()];
}
