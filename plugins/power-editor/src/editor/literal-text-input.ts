import { Plugin, editorLivePreviewField } from "obsidian";
import { EditorSelection, EditorState, Prec } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate, WidgetType } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { scanCodeBlocks } from "./utils/note-code-block.js";
import { decodeLiteralToken, escapeLiteralText, isEscapedAt, isInlineHtmlAt, isLiteralPunctuation, literalTextPattern, transformLiteralText } from "../utils/literal-text";
import { canFormatEditor } from "../utils/editor-context";

const codeRanges = new WeakMap<EditorState, ReturnType<typeof scanCodeBlocks>>();
const protectedSyntax = /code|math|frontmatter|hmd-internal-link|hmd-external-link/i;

function isProse(state: EditorState, from: number, to = from): boolean {
    if (state.readOnly || !state.field(editorLivePreviewField, false)) return false;
    let blocks = codeRanges.get(state);
    if (!blocks) { blocks = scanCodeBlocks(state.doc); codeRanges.set(state, blocks); }
    if (blocks.some(block => from <= block.to && to >= block.from)) return false;
    for (const at of [from, to]) {
        for (let node = syntaxTree(state).resolveInner(at, -1); node; node = node.parent!) {
            if (protectedSyntax.test(node.name)) return false;
        }
    }
    if (to > from) {
        let protectedRange = false;
        syntaxTree(state).iterate({ from, to, enter(node) {
            if (node.from < to && node.to > from && protectedSyntax.test(node.name)) protectedRange = true;
            if (protectedRange) return false;
        } });
        if (protectedRange) return false;
    }
    return true;
}

export function selectionIsProse(state: EditorState): boolean {
    return state.selection.ranges.every(range => isProse(state, range.from, range.to));
}

function literalInput(text: string, state: EditorState, at: number): string {
    const line = state.doc.lineAt(at);
    return escapeLiteralText(text, at === line.from, isInlineHtmlAt(line.text, at - line.from));
}

function copiedLiteralText(text: string, state: EditorState): string {
    if (!state.field(editorLivePreviewField, false)) return text;
    const selections = state.selection.ranges.map(range => range.empty ? state.doc.lineAt(range.from) : range);
    const raw = selections.map(range => state.sliceDoc(range.from, range.to));
    const joined = raw.join("\n");
    if (text !== joined && text !== joined + "\n") return text;
    const decoded = raw.map((value, index) => value.replace(literalTextPattern, (match, offset: number) => {
        const from = selections[index].from + offset;
        return isProse(state, from, from + match.length) ? transformLiteralText(match, part => part, true) : match;
    })).join("\n");
    return decoded + (text === joined ? "" : "\n");
}

class LiteralCharacterWidget extends WidgetType {
    constructor(private text: string) { super(); }
    eq(other: LiteralCharacterWidget): boolean { return this.text === other.text; }
    toDOM(view: EditorView): HTMLElement {
        const span = view.dom.ownerDocument.createElement("span");
        span.textContent = this.text;
        span.style.whiteSpace = "pre";
        return span;
    }
    ignoreEvent(): boolean { return false; }
}

/** Escape markers are hidden, while each visible punctuation character stays atomic. */
class LiteralTextView {
    decorations: DecorationSet = Decoration.none;
    atomics: DecorationSet = Decoration.none;

    constructor(private view: EditorView) { this.build(); }

    update(update: ViewUpdate): void {
        if (update.docChanged || update.viewportChanged || update.selectionSet ||
            syntaxTree(update.startState) !== syntaxTree(update.state)) this.build();
    }

    private build(): void {
        const hidden = [], atomic = [];
        if (this.view.state.field(editorLivePreviewField, false)) {
            for (const visible of this.view.visibleRanges) {
                const text = this.view.state.doc.sliceString(visible.from, visible.to);
                const pattern = new RegExp(literalTextPattern.source, "g");
                for (let match; (match = pattern.exec(text));) {
                    const from = visible.from + match.index;
                    const to = from + match[0].length;
                    if (!isProse(this.view.state, from, to)) continue;
                    const entity = match[0][0] === "&";
                    hidden.push(Decoration.replace(entity ? {
                        widget: new LiteralCharacterWidget(decodeLiteralToken(match[0])),
                    } : {}).range(from, entity ? to : from + 1));
                    atomic.push(Decoration.mark({}).range(from, to));
                }
            }
        }
        this.decorations = Decoration.set(hidden, true);
        this.atomics = Decoration.set(atomic, true);
    }
}

export function installLiteralTextInput(plugin: Plugin): void {
    const visuals = ViewPlugin.define(view => new LiteralTextView(view), {
        decorations: value => value.decorations,
        provide: extension => EditorView.atomicRanges.of(view => view.plugin(extension)?.atomics ?? Decoration.none),
    });
    plugin.registerEditorExtension([
        Prec.highest(EditorView.inputHandler.of((view, from, to, text, insert) => {
            if (!isProse(view.state, from, to)) return false;
            if (literalInput(text, view.state, from) === text) return false;
            const transaction = insert();
            const changes: { from: number; to: number; insert: string }[] = [];
            transaction.changes.iterChanges((fromA, toA, start, end, inserted) => {
                if (!isProse(view.state, fromA, toA)) return;
                const raw = inserted.toString();
                const escaped = literalInput(raw, view.state, fromA);
                if (raw !== escaped) changes.push({ from: start, to: end, insert: escaped });
            });
            view.dispatch(view.state.update(transaction, { changes, sequential: true }));
            return true;
        })),
        visuals,
        EditorState.transactionFilter.of(transaction => {
            if (transaction.docChanged || !transaction.selection || !transaction.startState.field(editorLivePreviewField, false)) return transaction;
            const text = transaction.startState.doc.toString();
            const insideEscape = (at: number) => at > 0 && isEscapedAt(text, at) && isLiteralPunctuation(text[at] ?? "");
            let changed = false;
            const ranges = transaction.newSelection.ranges.map(range => {
                if (!isProse(transaction.startState, range.from, range.to)) return range;
                const from = insideEscape(range.from) ? range.from - 1 : range.from;
                const to = insideEscape(range.to) ? range.to + 1 : range.to;
                if (from === range.from && to === range.to) return range;
                changed = true;
                if (range.empty) return EditorSelection.cursor(range.assoc < 0 ? from : to);
                return range.anchor < range.head ? EditorSelection.range(from, to) : EditorSelection.range(to, from);
            });
            return changed ? [transaction, { selection: EditorSelection.create(ranges, transaction.newSelection.mainIndex), sequential: true }] : transaction;
        }),
        EditorView.clipboardInputFilter.of((text, state) => selectionIsProse(state) ? literalInput(text, state, state.selection.main.from) : text),
        EditorView.clipboardOutputFilter.of(copiedLiteralText),
    ]);
    // Run before the rich-paste heuristics. Normal paste is text; explicit toolbar
    // commands remain the way to insert formatted Markdown, tables and code.
    plugin.registerEvent(plugin.app.workspace.on("editor-paste", (event, editor) => {
        const cm = (editor as typeof editor & { cm?: EditorView }).cm;
        if (event.defaultPrevented || !cm || !selectionIsProse(cm.state) || !canFormatEditor(plugin.app, editor)) return;
        if (event.clipboardData?.files.length) return;
        const text = event.clipboardData?.getData("text/plain");
        if (!text) return;
        event.preventDefault();
        editor.replaceSelection(literalInput(text.replace(/\r\n?/g, "\n"), cm.state, cm.state.selection.main.from));
    }));
}
