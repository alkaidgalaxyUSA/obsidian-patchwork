import { Menu, Notice } from "obsidian";
import { EditorView, ViewPlugin } from "@codemirror/view";
import { undo, redo, undoDepth, redoDepth, selectAll } from "@codemirror/commands";
import { scopeModule } from "../../../utils/module-scope";

// Use an application menu so the window's menu palette also applies to code files.
export const codeContextMenu = ViewPlugin.define(view => {
	let menu: Menu | undefined;
	return {
		open(event: MouseEvent) {
			menu?.hide();
			const current = new Menu().setUseNativeMenu(false);
			menu = current;
			const scope = scopeModule((current as Menu & { dom: HTMLElement }).dom, "content", { surface: "code-menu" });
			current.onHide(() => { scope.dispose(); if (menu === current) menu = undefined; });
			const state = view.state;
			const valid = () => view.dom.isConnected && view.state.doc === state.doc &&
				view.state.selection.eq(state.selection) && view.state.readOnly === state.readOnly;
			const selected = state.selection.ranges.some(range => !range.empty);
			const edit = async (action: "copy" | "cut" | "paste") => {
				if (!valid()) return;
				try {
					const clipboard = view.dom.ownerDocument.defaultView?.navigator.clipboard;
					if (!clipboard) throw new Error("Clipboard unavailable");
					if (action === "paste") {
						const text = await clipboard.readText();
						if (!valid() || state.readOnly) return;
						view.dispatch(state.replaceSelection(text), { userEvent: "input.paste", scrollIntoView: true });
					} else {
						await clipboard.writeText(state.selection.ranges.map(range => state.sliceDoc(range.from, range.to)).join("\n"));
						if (action === "cut" && valid() && !state.readOnly) view.dispatch(state.replaceSelection(""), { userEvent: "delete.cut" });
					}
					if (view.dom.isConnected) view.focus();
				} catch { new Notice("Clipboard operation failed. Check clipboard permissions and try again."); }
			};
			const command = (run: (view: EditorView) => boolean) => { if (valid()) { view.focus(); run(view); } };
			current.addItem(item => item.setTitle("Undo").setDisabled(state.readOnly || !undoDepth(state)).onClick(() => command(undo)));
			current.addItem(item => item.setTitle("Redo").setDisabled(state.readOnly || !redoDepth(state)).onClick(() => command(redo)));
			current.addSeparator();
			current.addItem(item => item.setTitle("Cut").setDisabled(state.readOnly || !selected).onClick(() => edit("cut")));
			current.addItem(item => item.setTitle("Copy").setDisabled(!selected).onClick(() => edit("copy")));
			current.addItem(item => item.setTitle("Paste").setDisabled(state.readOnly).onClick(() => edit("paste")));
			current.addSeparator();
			current.addItem(item => item.setTitle("Select all").onClick(() => command(selectAll)));
			current.showAtMouseEvent(event);
		},
		destroy() { menu?.hide(); },
	};
}, {
	eventHandlers: {
		contextmenu(event) {
			event.preventDefault();
			event.stopPropagation();
			this.open(event);
			return true;
		},
	},
});
