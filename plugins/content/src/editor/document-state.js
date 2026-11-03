import { TFile } from "obsidian";
import { getWindowContext, resolveWindow } from "../../../utils/windows";
import { getServiceRegistry } from "../../../utils/service-registry";
import { ModuleUnavailableError } from "../../../utils/module-errors";
import { isMarkdownView, isEncryptedNote } from "../utils/markdown-views";
import { noteHeadings } from "../utils/note-headings";
import { outlineLabel } from "./utils/outline-headings";
import { scrollDocumentHeading } from "./utils/document-heading-scroll";
import { DocumentFileLock } from "./document-file-lock";
import { DocumentEncoding } from "./document-encoding";
import { openUnindexedDocument } from "./unindexed-document";

/** Own document observation independently of the footer or focused tool panel. */
export class DocumentState {
    constructor(plugin) {
        this.plugin = plugin;
        this.app = plugin.app;
        this.records = new Map();
        this.listeners = new Set();
        this.selectionListeners = new Set();
        this.documents = new Map();
        this.ids = new WeakMap();
        this.lineEndings = new WeakMap();
        this.nextId = 0;
        this.locks = new DocumentFileLock(plugin, () => this.schedule());
        this.encodings = new DocumentEncoding(this);
        plugin.documentFileLock = this.locks;
        const registry = getServiceRegistry(this.app);
        this.stopCode = registry.watch("content", "codeDocument", api => {
            this.stopCodeChanges?.();
            this.code = api;
            this.stopCodeChanges = api?.onChange(() => this.schedule());
            this.schedule();
        });
        for (const event of ["active-leaf-change", "patchwork:document-tab-activated"]) {
            plugin.registerEvent(this.app.workspace.on(event, leaf => { this.select(leaf); this.schedule(); }));
        }
        for (const event of ["layout-change", "file-open", "window-open", "editor-change"]) {
            plugin.registerEvent(this.app.workspace.on(event, () => this.schedule(event !== "editor-change")));
        }
        for (const event of ["modify", "rename", "delete"]) {
            plugin.registerEvent(this.app.vault.on(event, () => this.schedule(true)));
        }
        this.app.workspace.onLayoutReady(() => this.schedule());
        const win = this.app.workspace.containerEl.ownerDocument.defaultView;
        this.interval = win.setInterval(() => { void this.refresh(); }, 1500);
        this.select(this.app.workspace.activeLeaf);
    }

    leaves() {
        const leaves = [];
        this.app.workspace.iterateAllLeaves(leaf => {
            if (leaf.view.file && leaf.view.containerEl.closest(".mod-root")) leaves.push(leaf);
        });
        return leaves;
    }

    id(leaf) {
        if (typeof leaf.id === "string") return leaf.id;
        if (!this.ids.has(leaf)) this.ids.set(leaf, `pw-document-${++this.nextId}`);
        return this.ids.get(leaf);
    }

    context(context) {
        context.signal?.throwIfAborted();
        const current = resolveWindow(context.windowId);
        if (this.disposed || current?.document !== context.document) {
            throw new ModuleUnavailableError("content", "The document window is no longer available.");
        }
        return current;
    }

    select(leaf) {
        if (!leaf?.view.file || !leaf.view.containerEl.closest(".mod-root")) return;
        const context = getWindowContext(leaf.view.containerEl.ownerDocument);
        const record = this.records.get(context.windowId) ?? { context };
        if (record.leaf !== leaf) { record.readingLine = undefined; record.cursor = undefined; }
        record.leaf = leaf;
        this.records.set(context.windowId, record);
    }

    leaf(location, context) {
        this.context(context);
        const leaf = this.leaves().find(candidate => this.id(candidate) === location.leafId
            && candidate.view.file?.path === location.path
            && candidate.view.containerEl.ownerDocument === context.document);
        if (!leaf) throw new ModuleUnavailableError("content", "The requested document is no longer open in this window.");
        return leaf;
    }

    location(leaf) { return { leafId: this.id(leaf), path: leaf.view.file.path }; }

    schedule(readDisk = false) {
        this.readDisk = this.readDisk || readDisk;
        if (this.disposed || this.scheduled) return;
        this.scheduled = true;
        queueMicrotask(() => {
            this.scheduled = false; const requested = this.readDisk; this.readDisk = false;
            if (!this.disposed) void this.refresh(requested);
        });
    }

    attachDocuments(leaves) {
        const current = new Set([this.app.workspace.containerEl.ownerDocument,
            ...leaves.map(leaf => leaf.view.containerEl.ownerDocument)]);
        for (const [doc, remove] of this.documents) {
            if (!current.has(doc) || !doc.defaultView || doc.defaultView.closed) { remove(); this.documents.delete(doc); }
        }
        for (const doc of current) {
            if (this.documents.has(doc) || !doc.defaultView || doc.defaultView.closed) continue;
            const context = getWindowContext(doc);
            const guard = event => {
                if (!event.target.closest?.(".workspace-leaf-content.pw-file-readonly")) return;
                if (event.type !== "click" || event.target.closest("input[type=checkbox], .pw-document-mode-action")) {
                    event.preventDefault(); event.stopImmediatePropagation();
                }
            };
            const reading = event => {
                if (event.button !== 0 || event.target.closest?.(".mod-ui, .metadata-container, .inline-title")) return;
                const leaf = this.leaves().find(item => isMarkdownView(item.view) && item.view.getMode() === "preview"
                    && item.view.containerEl.ownerDocument === doc && item.view.previewMode?.renderer?.previewEl.contains(event.target));
                if (!leaf) return;
                const renderer = leaf.view.previewMode.renderer;
                const section = renderer.getSectionForElement(event.target) ?? renderer.sections.findLast(item =>
                    item.el?.getClientRects().length && item.el.getBoundingClientRect().top <= event.clientY);
                if (!Number.isInteger(section?.start?.line)) return;
                this.select(leaf);
                this.records.get(getWindowContext(doc).windowId).readingLine = section.start.line;
                this.schedule();
            };
            const changed = () => this.schedule();
            const types = ["beforeinput", "paste", "cut", "drop", "click"];
            for (const type of types) doc.addEventListener(type, guard, true);
            doc.addEventListener("click", reading, true);
            doc.addEventListener("selectionchange", changed);
            doc.defaultView.addEventListener("focus", changed);
            const close = () => {
                this.records.delete(context.windowId);
                remove(); this.documents.delete(doc);
            };
            const remove = () => {
                for (const type of types) doc.removeEventListener(type, guard, true);
                doc.removeEventListener("click", reading, true);
                doc.removeEventListener("selectionchange", changed);
                doc.defaultView?.removeEventListener("focus", changed);
                doc.defaultView?.removeEventListener("unload", close);
            };
            doc.defaultView.addEventListener("unload", close, { once: true });
            this.documents.set(doc, remove);
        }
    }

    async refresh(readDisk = true) {
        if (this.disposed) return;
        const leaves = this.leaves();
        this.attachDocuments(leaves);
        const selected = leaves.filter(leaf => leaf.parent?.children?.[leaf.parent.currentTab] === leaf)
            .sort((left, right) => (right.activeTime ?? 0) - (left.activeTime ?? 0));
        for (const leaf of [...selected, ...leaves]) {
            const context = getWindowContext(leaf.view.containerEl.ownerDocument);
            if (!this.records.get(context.windowId)?.leaf || !this.app.workspace.isAttached(this.records.get(context.windowId).leaf)) this.select(leaf);
        }
        const views = leaves.map(leaf => leaf.view).filter(view => isMarkdownView(view) || view.getViewType() === "code-editor");
        this.locks.sync(views);
        this.publish();
        if (readDisk && typeof this.app.vault.adapter.getFullPath === "function") await this.locks.refresh(views);
        if (this.disposed) return;
        this.locks.sync(this.leaves().map(leaf => leaf.view).filter(view => isMarkdownView(view) || view.getViewType() === "code-editor"));
        this.publish();
    }

    headingTree(leaf) {
        if (!isMarkdownView(leaf.view)) return [];
        // noteHeadings can resolve another open view; require the current window's
        // unlocked view before invoking it, and never publish encrypted labels.
        const roots = [], stack = [];
        for (const heading of noteHeadings(this.app, leaf.view.file, leaf.view)) {
            const node = { id: `${this.id(leaf)}:${heading.position.start.line}`, label: outlineLabel(heading.heading) || heading.heading,
                level: heading.level, line: heading.position.start.line, children: [] };
            while (stack.length && stack.at(-1).level >= node.level) stack.pop();
            (stack.at(-1)?.children ?? roots).push(node);
            stack.push(node);
        }
        return roots;
    }

    /** @returns {import("../../../contracts/content").DocumentSnapshot} */
    snapshot(context) {
        const empty = { windowId: context.windowId, canToggleReadOnly: false, activeHeadingTrail: [] };
        const record = this.records.get(context.windowId);
        const leaf = record?.leaf;
        if (!leaf || !this.app.workspace.isAttached(leaf) || leaf.view.containerEl.ownerDocument !== context.document) return empty;
        const view = leaf.view, file = view.file;
        if (!file) return empty;
        const location = this.location(leaf);
        if (this.code?.supports(location.leafId, context)) {
            const info = this.locks.info.get(file.path);
            return { ...this.code.getSnapshot(location.leafId, context), encoding: this.encodings.encodings.get(file.path) ?? info?.encoding,
                canChangeEncoding: this.encodings.available(leaf), encodingPending: this.encodings.pending.has(file.path),
                readOnly: info?.readOnly, lockPending: this.locks.pending.has(file.path),
                canToggleReadOnly: !!info && typeof this.app.vault.adapter.getFullPath === "function" };
        }
        const supported = isMarkdownView(view) || view.getViewType() === "code-editor";
        const preview = view.getMode?.() === "preview";
        const cm = supported && this.locks.editor(view);
        let cursor;
        if (!preview && cm?.state) {
            const head = cm.state.selection.main.head, line = cm.state.doc.lineAt(head);
            cursor = { line: line.number - 1, column: Array.from(line.text.slice(0, head - line.from)).length };
        } else if (!preview && supported && view.editor?.getCursor) {
            const point = view.editor.getCursor(); cursor = { line: point.line, column: point.ch };
        }
        if (cursor) record.cursor = cursor;
        const line = preview ? record.readingLine : cursor?.line;
        const trail = [];
        let nodes = supported && !isEncryptedNote(file) ? this.headingTree(leaf) : [];
        while (Number.isInteger(line) && nodes.length) {
            const node = nodes.findLast(item => item.line <= line);
            if (!node) break;
            trail.push({ ...node, children: [] }); nodes = node.children;
        }
        const info = this.locks.info.get(file.path);
        const document = supported && !isEncryptedNote(file) ? cm?.state?.doc : undefined;
        if (document && !this.lineEndings.has(document)) this.lineEndings.set(document, document.toString().includes("\r\n") ? "CRLF" : "LF");
        return { ...empty, location, displayPath: file.path, cursor: supported ? record.cursor : undefined,
            canChangeEncoding: this.encodings.available(leaf), encodingPending: this.encodings.pending.has(file.path),
            encoding: this.encodings.encodings.get(file.path) ?? info?.encoding, lineEnding: document ? this.lineEndings.get(document) : undefined,
            readOnly: supported ? info?.readOnly : undefined, lockPending: this.locks.pending.has(file.path),
            canToggleReadOnly: supported && !!info && typeof this.app.vault.adapter.getFullPath === "function",
            mode: isMarkdownView(view) ? view.getMode() : view.getViewType() === "code-editor" ? "code" : undefined,
            activeHeadingTrail: trail };
    }

    selection(context) {
        const leaf = this.records.get(context.windowId)?.leaf;
        if (leaf?.view.file && this.code?.supports(this.id(leaf), context)) return this.code.getSelection(this.id(leaf), context);
        if (!leaf || !this.app.workspace.isAttached(leaf) || !isMarkdownView(leaf.view)
            || isEncryptedNote(leaf.view.file) || leaf.view.containerEl.ownerDocument !== context.document) return undefined;
        const editor = leaf.view.editor;
        if (!editor?.getSelection) return undefined;
        const selectedText = editor.getSelection();
        return { windowId: context.windowId, location: this.location(leaf), selectedText,
            lineCount: selectedText ? selectedText.split(/\r?\n/).length : 0, startLine: editor.getCursor("from").line };
    }

    deliver(listeners, value) {
        for (const listener of [...listeners]) {
            try { listener(value === undefined ? undefined : structuredClone(value)); } catch (error) { console.error("Patchwork document subscriber failed.", error); }
        }
    }

    publish() {
        for (const record of this.records.values()) {
            const snapshot = this.snapshot(record.context), selection = this.selection(record.context);
            const signature = JSON.stringify(snapshot), selected = JSON.stringify(selection);
            if (signature !== record.signature) { record.signature = signature; this.deliver(this.listeners, snapshot); }
            if (selected !== record.selected) { record.selected = selected; this.deliver(this.selectionListeners, selection); }
        }
    }

    subscribe(listeners, listener, selection = false) {
        if (this.disposed) return () => {};
        listeners.add(listener);
        for (const record of this.records.values()) this.deliver(new Set([listener]), selection ? this.selection(record.context) : this.snapshot(record.context));
        if (!this.records.size) {
            const context = getWindowContext(this.app.workspace.containerEl.ownerDocument);
            this.deliver(new Set([listener]), selection ? undefined : this.snapshot(context));
        }
        return () => listeners.delete(listener);
    }

    async open(request) {
        this.context(request);
        const file = this.app.vault.getAbstractFileByPath(request.path);
        if (!(file instanceof TFile)) return openUnindexedDocument(this, request);
        const leaves = this.leaves().filter(leaf => leaf.view.containerEl.ownerDocument === request.document);
        const group = request.groupLeafId && leaves.find(leaf => this.id(leaf) === request.groupLeafId)?.parent;
        if (request.groupLeafId && !group) throw new Error("The document group was closed. Open the navigation again.");
        let leaf = request.target !== "split" && leaves.find(leaf => leaf.view.file === file && (!group || leaf.parent === group));
        if (!leaf) {
            const anchor = group?.children[group.currentTab] ?? this.records.get(request.windowId)?.leaf;
            if (anchor) this.app.workspace.setActiveLeaf(anchor, { focus: false });
            else if (request.document !== this.app.workspace.containerEl.ownerDocument) throw new ModuleUnavailableError("content", "This window has no document group.");
            leaf = this.app.workspace.getLeaf(request.target === "split" ? "split" : request.target === "new-tab" || group ? "tab" : false);
            if (leaf.view.containerEl.ownerDocument !== request.document) throw new ModuleUnavailableError("content", "The requested document group is unavailable in this window.");
            await leaf.openFile(file, { active: request.focus !== false });
        }
        this.context(request);
        await leaf.loadIfDeferred();
        this.context(request);
        if (!this.app.workspace.isAttached(leaf) || leaf.view.file !== file || leaf.view.containerEl.ownerDocument !== request.document) {
            throw new ModuleUnavailableError("content", "The requested document changed while opening.");
        }
        this.app.workspace.setActiveLeaf(leaf, { focus: request.focus !== false });
        this.app.workspace.trigger("patchwork:document-tab-activated", leaf);
        this.select(leaf); this.schedule();
        return this.location(leaf);
    }

    async navigate(location, context) {
        const leaf = this.leaf(location, context), view = leaf.view;
        if (this.code?.supports(location.leafId, context)) { await this.code.navigate(location, context); return; }
        if (!isMarkdownView(view)) throw new ModuleUnavailableError("content", "This view cannot navigate document headings.");
        this.app.workspace.setActiveLeaf(leaf, { focus: true });
        const current = () => !this.disposed && !context.signal?.aborted && this.app.workspace.isAttached(leaf)
            && leaf.view === view && view.file?.path === location.path && isMarkdownView(view);
        const heading = noteHeadings(this.app, view.file, view).find(item => item.position.start.line === location.line);
        if (heading) await scrollDocumentHeading(view, heading, current);
        else if (Number.isInteger(location.line)) {
            view.editor?.setCursor({ line: location.line, ch: location.column ?? 0 });
            leaf.setEphemeralState({ line: location.line });
        }
        if (!current()) throw new ModuleUnavailableError("content", "The document changed while navigating.");
        this.select(leaf); this.records.get(context.windowId).readingLine = location.line; this.schedule();
    }

    dispose() {
        this.disposed = true;
        this.app.workspace.containerEl.ownerDocument.defaultView.clearInterval(this.interval);
        this.stopCode(); this.stopCodeChanges?.();
        this.locks.dispose();
        this.encodings.dispose();
        if (this.plugin.documentFileLock === this.locks) delete this.plugin.documentFileLock;
        for (const remove of this.documents.values()) remove();
        this.documents.clear(); this.records.clear(); this.listeners.clear(); this.selectionListeners.clear();
    }
}
