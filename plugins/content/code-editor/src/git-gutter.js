import { Menu, Modal, Notice } from "obsidian";
import { EditorState, RangeSet, StateEffect, StateField } from "@codemirror/state";
import { EditorView, GutterMarker, ViewPlugin, gutter } from "@codemirror/view";
import { getServiceRegistry } from "../../../utils/service-registry";
import { getWindowContext } from "../../../utils/windows";
import { scopeModule } from "../../../utils/module-scope";
import { changedLines } from "../../../utils/text-changes.js";

const replace = StateEffect.define();
const state = StateField.define({
    create: () => RangeSet.empty,
    update(value, transaction) {
        if (transaction.docChanged) value = RangeSet.empty;
        for (const effect of transaction.effects) if (effect.is(replace)) value = effect.value;
        return value;
    },
});

class CodeChangeMarker extends GutterMarker {
    constructor(adapter, change, text, baseline) { super(); Object.assign(this, { adapter, change, text, revision: baseline.revision, baseline: baseline.text, path: adapter.path }); }
    toDOM(view) {
        const button = view.dom.ownerDocument.createElement("button");
        button.type = "button"; button.className = `ce-git-change is-${this.change.type}`;
        button.setAttribute("aria-label", `Git ${this.change.type} lines`); button.title = "Show line change or roll back";
        button.onclick = event => this.adapter.show(this, event);
        return button;
    }
}

class CodeGitAdapter {
    constructor(view, owner) {
        this.view = view; this.owner = owner; this.generation = 0;
        this.stop = getServiceRegistry(owner.app).watch("content", "git", api => {
            this.unsubscribe?.(); this.api = api;
            this.unsubscribe = api?.onSnapshot(() => this.schedule()); this.schedule();
        });
    }
    update(update) { if (update.docChanged || this.path !== this.owner.file?.path) this.schedule(); }
    schedule() { if (this.closed) return; this.request?.abort(); ++this.generation; clearTimeout(this.timer); this.timer = setTimeout(() => void this.refresh(), 350); }
    async refresh() {
        const generation = this.generation, path = this.owner.file?.path, api = this.api, text = this.view.state.doc.toString();
        this.path = path;
        const request = new AbortController(); this.request = request;
        let baseline;
        try { if (path && !/\.mdenc$/i.test(path) && text.length <= 1024 * 1024) baseline = await api?.getFileBaseline?.(path, { ...getWindowContext(this.view.dom.ownerDocument), signal: request.signal }); } catch {}
        if (this.closed || generation !== this.generation || path !== this.owner.file?.path || api !== this.api) return;
        const ranges = baseline ? changedLines(baseline.text, text).flatMap(change => {
            const marker = new CodeChangeMarker(this, change, text, baseline);
            const first = this.view.state.doc.lineAt(change.from).number;
            const last = this.view.state.doc.lineAt(Math.max(change.from, change.to - 1)).number;
            return Array.from({ length: last - first + 1 }, (_, index) => marker.range(this.view.state.doc.line(first + index).from));
        }) : [];
        this.view.dispatch({ effects: replace.of(RangeSet.of(ranges, true)) });
    }
    show(marker, event) {
        this.menu?.hide(); const menu = new Menu(); this.menu = menu;
        const scope = scopeModule(menu.dom, "content", { surface: "code-git-menu" });
        menu.onHide(() => { scope.dispose(); if (this.menu === menu) this.menu = undefined; });
        menu.addItem(item => item.setTitle("Show Line Change").onClick(() => {
            this.modal?.close(); const modal = new Modal(this.owner.app); this.modal = modal;
            const scope = scopeModule(modal.modalEl, "content", { surface: "code-git-change" });
            modal.setTitle("Git Line Change");
            modal.contentEl.createEl("h4", { text: "HEAD" }); modal.contentEl.createEl("pre", { text: marker.change.insert || "(No previous lines)" });
            modal.contentEl.createEl("h4", { text: "Working version" }); modal.contentEl.createEl("pre", { text: marker.text.slice(marker.change.from, marker.change.to) || "(Lines deleted)" });
            modal.onClose = () => { scope.dispose(); if (this.modal === modal) this.modal = undefined; }; modal.open();
        }));
        menu.addItem(item => item.setTitle("Rollback Lines").setDisabled(this.view.state.facet(EditorState.readOnly)).onClick(() => void this.rollback(marker)));
        menu.showAtMouseEvent(event);
    }
    async rollback(marker) {
        const path = this.owner.file?.path, api = this.api;
        if (!path || this.closed || this.view.state.facet(EditorState.readOnly)) return;
        try {
            const baseline = await api?.getFileBaseline?.(path, getWindowContext(this.view.dom.ownerDocument));
            if (this.closed || api !== this.api || path !== this.owner.file?.path || path !== marker.path || baseline?.revision !== marker.revision || baseline?.text !== marker.baseline
                || this.view.state.doc.toString() !== marker.text || this.view.state.facet(EditorState.readOnly)) throw new Error("The file or Git baseline changed. Reopen the line change.");
            this.view.dispatch({ changes: { from: marker.change.from, to: marker.change.to, insert: marker.change.insert }, userEvent: "input.git.rollback" }); this.view.focus();
        } catch (error) { new Notice(error.message); }
    }
    destroy() { this.closed = true; ++this.generation; this.request?.abort(); clearTimeout(this.timer); this.stop(); this.unsubscribe?.(); this.menu?.hide(); this.modal?.close(); }
}

export function codeGitExtensions(owner) {
    return [state, ViewPlugin.define(view => new CodeGitAdapter(view, owner)), gutter({ class: "ce-git-gutter", markers: view => view.state.field(state) }), EditorView.baseTheme({
        ".ce-git-gutter": { width: "8px" },
        ".ce-git-change": { display: "block", width: "4px", minWidth: "4px", height: "100%", minHeight: "12px", padding: "0", margin: "0 2px", border: "0", borderRadius: "0", boxShadow: "none", background: "#71A1FE" },
        ".ce-git-change.is-added": { background: "#73BD79" },
        ".ce-git-change.is-deleted": { background: "#F57E84", height: "4px", minHeight: "4px" },
    })];
}
