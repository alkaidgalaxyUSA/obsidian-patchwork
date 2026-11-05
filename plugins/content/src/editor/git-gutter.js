import { editorInfoField, Notice } from "obsidian";
import { EditorState, RangeSet, StateEffect, StateField } from "@codemirror/state";
import { EditorView, GutterMarker, ViewPlugin, gutter } from "@codemirror/view";
import { getServiceRegistry } from "../../../utils/service-registry";
import { getWindowContext } from "../../../utils/windows";
import { ContentMenu, ContentModal } from "../utils/portals";
import { changedLines } from "../../../utils/text-changes.js";

const replaceMarkers = StateEffect.define();
const markers = StateField.define({
    create: () => RangeSet.empty,
    update(value, transaction) {
        if (transaction.docChanged) value = RangeSet.empty;
        for (const effect of transaction.effects) if (effect.is(replaceMarkers)) value = effect.value;
        return value;
    },
});

class ChangeMarker extends GutterMarker {
    constructor(owner, change, text, baseline) { super(); Object.assign(this, { owner, change, text, revision: baseline.revision, baseline: baseline.text, path: owner.path }); }
    toDOM(view) {
        const button = view.dom.ownerDocument.createElement("button");
        button.type = "button"; button.className = `pw-editor-git-marker is-${this.change.type}`;
        button.title = `Git: ${this.change.type} lines — show change or roll back`;
        button.setAttribute("aria-label", button.title);
        button.onclick = event => this.owner.showChange(this, event);
        return button;
    }
}

class GitGutterView {
    constructor(view, plugin) {
        this.view = view; this.plugin = plugin; this.generation = 0;
        this.registry = getServiceRegistry(plugin.app);
        this.stop = this.registry.watch("content", "git", api => {
            this.unsubscribe?.(); this.api = api;
            this.unsubscribe = api?.onSnapshot(() => this.schedule());
            this.schedule();
        });
    }
    file() {
        if (this.view.dom.closest('[data-type="meld-encrypted-view"]')) return undefined;
        const file = this.view.state.field(editorInfoField, false)?.file;
        return file && file.extension.toLowerCase() === "md" ? file : undefined;
    }
    update(update) { if (update.docChanged || this.file()?.path !== this.path) this.schedule(); }
    schedule() {
        if (this.closed) return;
        this.request?.abort();
        ++this.generation; clearTimeout(this.timer);
        this.timer = setTimeout(() => void this.refresh(), 350);
    }
    async refresh() {
        const generation = this.generation, file = this.file(), api = this.api;
        this.path = file?.path;
        const text = this.view.state.doc.toString();
        const context = getWindowContext(this.view.dom.ownerDocument);
        const request = new AbortController(); this.request = request;
        let baseline;
        try { if (file && text.length <= 1024 * 1024) baseline = await api?.getFileBaseline?.(file.path, { ...context, signal: request.signal }); }
        catch { baseline = undefined; }
        if (this.closed || generation !== this.generation || api !== this.api || file !== this.file() || this.path !== file?.path) return;
        const ranges = baseline ? changedLines(baseline.text, text).flatMap(change => {
            const marker = new ChangeMarker(this, change, text, baseline);
            const first = this.view.state.doc.lineAt(Math.min(change.from, text.length)).number;
            const last = this.view.state.doc.lineAt(Math.min(Math.max(change.from, change.to - 1), text.length)).number;
            return Array.from({ length: last - first + 1 }, (_, index) => marker.range(this.view.state.doc.line(first + index).from));
        }) : [];
        this.view.dispatch({ effects: replaceMarkers.of(RangeSet.of(ranges, true)) });
    }
    showChange(marker, event) {
        this.menu?.hide();
        const menu = new ContentMenu(); this.menu = menu;
        menu.addItem(item => item.setTitle("Show Line Change").onClick(() => {
            this.preview?.close();
            const modal = new ContentModal(this.plugin.app); this.preview = modal;
            modal.setTitle("Git Line Change");
            modal.contentEl.createEl("h4", { text: "HEAD" });
            modal.contentEl.createEl("pre", { text: marker.change.insert || "(No previous lines)" });
            modal.contentEl.createEl("h4", { text: "Working version" });
            modal.contentEl.createEl("pre", { text: marker.text.slice(marker.change.from, marker.change.to) || "(Lines deleted)" });
            modal.onClose = () => { if (this.preview === modal) this.preview = undefined; };
            modal.open();
        }));
        menu.addItem(item => item.setTitle("Copy Previous Lines").setDisabled(!marker.change.insert).onClick(() => {
            void this.view.dom.ownerDocument.defaultView.navigator.clipboard.writeText(marker.change.insert).catch(error => new Notice(error.message));
        }));
        menu.addItem(item => item.setTitle("Rollback Lines").setDisabled(this.view.state.facet(EditorState.readOnly)).onClick(() => void this.rollback(marker)));
        menu.onHide(() => { if (this.menu === menu) this.menu = undefined; });
        menu.showAtMouseEvent(event);
    }
    async rollback(marker) {
        const file = this.file(), api = this.api, path = file?.path;
        if (!file || this.closed || this.view.state.facet(EditorState.readOnly)) return;
        try {
            const baseline = await api?.getFileBaseline?.(path, getWindowContext(this.view.dom.ownerDocument));
            if (this.closed || api !== this.api || file !== this.file() || path !== file.path || path !== marker.path || baseline?.revision !== marker.revision || baseline?.text !== marker.baseline
                || this.view.state.doc.toString() !== marker.text || this.view.state.facet(EditorState.readOnly)) {
                throw new Error("The file or Git baseline changed. Reopen the line change.");
            }
            this.view.dispatch({ changes: { from: marker.change.from, to: marker.change.to, insert: marker.change.insert }, userEvent: "input.git.rollback" });
            this.view.focus();
        } catch (error) { new Notice(error.message); }
    }
    destroy() { this.closed = true; ++this.generation; this.request?.abort(); clearTimeout(this.timer); this.stop(); this.unsubscribe?.(); this.menu?.hide(); this.preview?.close(); }
}

export function installGitGutter(plugin) {
    plugin.registerEditorExtension([
        markers,
        ViewPlugin.define(view => new GitGutterView(view, plugin)),
        gutter({ class: "pw-editor-git-gutter", markers: view => view.state.field(markers) }),
        EditorView.baseTheme({
            ".pw-editor-git-gutter": { width: "8px", cursor: "pointer" },
            ".pw-editor-git-marker": { display: "block", width: "4px", minWidth: "4px", height: "100%", minHeight: "12px", padding: "0", margin: "0 2px", border: "0", borderRadius: "0", boxShadow: "none", background: "#71A1FE" },
            ".pw-editor-git-marker.is-added": { background: "#73BD79" },
            ".pw-editor-git-marker.is-deleted": { background: "#F57E84", height: "4px", minHeight: "4px" },
        }),
    ]);
}
