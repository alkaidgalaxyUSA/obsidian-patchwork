import { Notice } from "obsidian";
import { StateEffect, StateField } from "@codemirror/state";
import type { Range } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin } from "@codemirror/view";
import { findSqlSection, parseSqlSections, sqlSectionText } from "./utils/sql-sections";
import type { SqlSection } from "./utils/sql-sections";

const sqlSectionsField = StateField.define<readonly SqlSection[]>({
	create: state => parseSqlSections(state.doc),
	update: (sections, transaction) => transaction.docChanged
		? parseSqlSections(transaction.newDoc)
		: sections,
});

const hoverSqlSection = StateEffect.define<number | undefined>();
const hoveredSectionField = StateField.define<number | undefined>({
	create: () => undefined,
	update: (position, transaction) => {
		if (transaction.docChanged) return undefined;
		for (const effect of transaction.effects) {
			if (effect.is(hoverSqlSection)) return effect.value;
		}
		return position;
	},
});

function setHoveredSection(view: EditorView, position?: number): void {
	if (view.state.field(hoveredSectionField) === position) return;
	view.dispatch({ effects: hoverSqlSection.of(position) });
}

function sectionAtEvent(view: EditorView, event: MouseEvent): SqlSection | undefined {
	const line = (event.target as HTMLElement | null)?.closest?.(".cm-line");
	if (!line || !view.contentDOM.contains(line)) return undefined;
	return findSqlSection(view.state.field(sqlSectionsField), view.posAtDOM(line), view.state.doc.length);
}

async function copySqlText(view: EditorView, text: string): Promise<boolean> {
	if (!text.trim()) {
		new Notice("The SQL section or selection is empty. Nothing was copied.");
		return false;
	}
	try {
		const clipboard = view.dom.ownerDocument.defaultView?.navigator.clipboard;
		if (!clipboard) throw new Error("Clipboard is unavailable");
		await clipboard.writeText(text);
		return true;
	} catch {
		new Notice("Copy failed. Check clipboard permissions and try again.");
		return false;
	}
}

async function copySqlSectionAt(view: EditorView, position: number): Promise<boolean> {
	const section = findSqlSection(view.state.field(sqlSectionsField, false) ?? [], position, view.state.doc.length);
	if (!section) {
		new Notice("No SQL section at this position. Add -- @section Section name, or select the SQL to copy.");
		return false;
	}
	return copySqlText(view, sqlSectionText(view.state.doc, section));
}

export async function copySqlSelectionOrSection(view: EditorView): Promise<void> {
	const ranges = view.state.selection.ranges.filter(range => !range.empty);
	const copied = ranges.length
		? await copySqlText(view, ranges.map(range => view.state.sliceDoc(range.from, range.to)).join("\n"))
		: await copySqlSectionAt(view, view.state.selection.main.head);
	if (copied) new Notice(ranges.length ? "SQL selection copied." : "SQL section copied.");
}

function sectionDecorations(view: EditorView) {
	const decorations: Range<Decoration>[] = [];
	const hovered = view.state.field(hoveredSectionField);
	for (const section of view.state.field(sqlSectionsField)) {
		if (section.from === hovered) {
			const lines = new Set<number>();
			for (const range of view.visibleRanges) {
				if (range.to < section.from || range.from > section.to) continue;
				const first = view.state.doc.lineAt(Math.max(range.from, section.from)).number;
				const last = view.state.doc.lineAt(Math.min(range.to, section.to)).number;
				for (let number = first; number <= last; number++) {
					const line = view.state.doc.line(number);
					if (line.from >= section.to && section.to !== view.state.doc.length) break;
					lines.add(line.from);
				}
			}
			for (const from of lines) {
				decorations.push(Decoration.line({ class: "ce-sql-section-hover" }).range(from));
			}
		}
	}
	return Decoration.set(decorations, true);
}

const sqlSectionControls = ViewPlugin.define(view => ({
	decorations: sectionDecorations(view),
	update(update) {
		if (update.docChanged || update.viewportChanged ||
			update.startState.field(hoveredSectionField) !== update.state.field(hoveredSectionField)) {
			this.decorations = sectionDecorations(update.view);
		}
	},
}), {
	decorations: plugin => plugin.decorations,
	eventHandlers: {
		contextmenu(event, view) {
			const section = sectionAtEvent(view, event);
			if (!section) return false;
			// Select the group for the host's native Copy action. Do not replace,
			// cancel or reorder the native context menu and its other actions.
			const text = sqlSectionText(view.state.doc, section);
			const from = section.bodyFrom + view.state.sliceDoc(section.bodyFrom, section.to).indexOf(text);
			view.dispatch({
				selection: { anchor: from, head: from + (text.trim() ? text.length : 0) },
				effects: hoverSqlSection.of(section.from),
			});
			view.focus();
			return false;
		},
	},
	eventObservers: {
		mousemove(event, view) {
			setHoveredSection(view, sectionAtEvent(view, event)?.from);
		},
		mouseleave(_event, view) { setHoveredSection(view); },
		scroll(_event, view) { setHoveredSection(view); },
	},
});

export const sqlSectionExtensions = [sqlSectionsField, hoveredSectionField, sqlSectionControls];
