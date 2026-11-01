import { markdownLeaves } from "../utils/markdown-views";
class NoteTitle {
    constructor(plugin, api) {
        this.app = plugin.app;
        this.api = api;
        this.entries = new Map();
        this.records = new WeakMap();
        this.effect = api.StateEffect.define();
        plugin.registerEditorExtension([
            api.invertedEffects.of((transaction) => transaction.effects.filter((effect) => effect.is(this.effect))
                .map(({ value }) => this.effect.of({ ...value, before: value.after, after: value.before }))),
            api.EditorView.updateListener.of((update) => {
                if (this.disposed) return;
                for (const transaction of update.transactions) for (const effect of transaction.effects) {
                    if (effect.is(this.effect)) this.apply(update.view, effect.value,
                        transaction.isUserEvent("undo") || transaction.isUserEvent("redo"));
                }
            }),
        ]);
        for (const event of ["layout-change", "file-open", "active-leaf-change"]) {
            plugin.registerEvent(this.app.workspace.on(event, () => this.refresh()));
        }
        plugin.registerEvent(this.app.vault.on("rename", () => this.refresh()));
        this.app.workspace.onLayoutReady(() => { if (!this.disposed) this.refresh(); });
    }

    record(file) {
        if (!this.records.has(file)) this.records.set(file, {
            file, name: file.basename, value: { text: this.displayName(file), anchor: 0, head: 0 }, revision: 0,
        });
        return this.records.get(file);
    }

    displayName(file) { return /^Untitled(?: \d+)?$/i.test(file.basename) ? "" : file.basename; }

    refresh() {
        if (this.disposed) return;
        const views = new Set(markdownLeaves(this.app).map((leaf) => leaf.view));
        for (const [view, entry] of this.entries) {
            if (views.has(view) && view.inlineTitleEl === entry.title) continue;
            entry.cleanup();
            this.entries.delete(view);
        }
        for (const view of views) {
            if (!view.inlineTitleEl || !view.file) continue;
            if (!this.entries.has(view)) this.bind(view);
            this.sync(view);
        }
    }

    selection(title) {
        const selection = title.ownerDocument.getSelection();
        const offset = (node, position) => {
            if (!node || (node !== title && !title.contains(node))) return title.textContent.length;
            const range = title.ownerDocument.createRange();
            range.selectNodeContents(title);
            range.setEnd(node, position);
            return range.toString().length;
        };
        return { anchor: offset(selection?.anchorNode, selection?.anchorOffset), head: offset(selection?.focusNode, selection?.focusOffset) };
    }

    restoreSelection(title, value) {
        const node = title.firstChild ?? title;
        const length = node.nodeType === 3 ? node.textContent.length : 0;
        title.ownerDocument.getSelection()?.setBaseAndExtent(node, Math.min(value.anchor, length), node, Math.min(value.head, length));
    }

    sync(view) {
        const title = view.inlineTitleEl;
        if (!view.file || !title) return;
        const entry = this.entries.get(view);
        // Native editing can run a mutation checkpoint before the input event arrives.
        if (entry?.editing || entry?.composing) return;
        const record = this.record(view.file);
        if (!record.running && record.name !== view.file.basename) {
            record.name = view.file.basename;
            record.value = { text: this.displayName(view.file), anchor: 0, head: 0 };
        }
        const reading = view.containerEl.dataset.mode === "preview";
        const editable = reading ? "false" : "plaintext-only";
        if (title.contentEditable !== editable) title.contentEditable = editable;
        title.classList.add("pw-note-title");
        title.dataset.placeholder = "Please enter the title";
        title.setAttribute("role", "heading");
        title.setAttribute("aria-level", "1");
        if (this.entries.get(view)?.composing) return;
        const focused = title.ownerDocument.activeElement === title;
        if (title.textContent === record.value.text) {
            if (!record.value.text && title.childNodes.length) title.replaceChildren();
            if (record.running && focused && !reading) this.restoreSelection(title, record.value);
            return;
        }
        title.textContent = record.value.text;
        if (focused && !reading) this.restoreSelection(title, record.value);
    }

    input(view) {
        const entry = this.entries.get(view);
        if (entry) entry.editing = false;
        if (!view.file || view.getMode() !== "source") return;
        if (entry?.composing) return;
        const record = this.record(view.file);
        const after = { text: view.inlineTitleEl.textContent, ...this.selection(view.inlineTitleEl) };
        if (after.text === record.value.text) return;
        view.editor.cm.dispatch({
            effects: this.effect.of({ file: view.file, before: record.value, after }),
            annotations: this.api.isolateHistory.of("full"), userEvent: "input.title",
        });
    }

    apply(cm, value, history) {
        const record = this.record(value.file);
        record.value = value.after;
        record.revision++;
        if (history) this.historyView = cm;
        for (const [view] of this.entries) {
            if (view.file !== value.file) continue;
            this.sync(view);
            if (history && view.editor?.cm === cm && view.getMode() === "source") {
                view.inlineTitleEl.focus({ preventScroll: true });
                this.restoreSelection(view.inlineTitleEl, value.after);
            }
        }
        this.rename(record);
    }

    destination(record, text) {
        const { file } = record;
        const folder = file.parent?.path === "/" ? "" : file.parent?.path ?? "";
        const path = (name) => `${folder ? `${folder}/` : ""}${name}.${file.extension}`;
        if (text) {
            if (/[\\/:*?"<>|\x00-\x1f]/.test(text) || /\.$/.test(text)) throw new Error("The title contains characters that cannot be used in a filename.");
            return path(text);
        }
        let name = "Untitled";
        for (let index = 1; this.app.vault.getAbstractFileByPath(path(name)) && this.app.vault.getAbstractFileByPath(path(name)) !== file; index++) name = `Untitled ${index}`;
        return path(name);
    }

    async rename(record) {
        if (record.running || this.disposed) return;
        record.running = true;
        try {
            let revision;
            do {
                revision = record.revision;
                try {
                    const destination = this.destination(record, record.value.text.trim());
                    const existing = this.app.vault.getAbstractFileByPath(destination);
                    if (existing && existing !== record.file) throw new Error("A note with this title already exists.");
                    if (destination !== record.file.path) await this.app.fileManager.renameFile(record.file, destination);
                    record.name = record.file.basename;
                    record.error = undefined;
                } catch (error) {
                    if (revision === record.revision && record.error !== error.message) new this.api.Notice(error.message);
                    record.error = error.message;
                }
            } while (!this.disposed && revision !== record.revision);
        } finally {
            record.running = false;
            for (const [view] of this.entries) if (view.file === record.file) this.sync(view);
        }
    }

    bind(view) {
        const title = view.inlineTitleEl;
        const attributes = ["contenteditable", "role", "aria-level", "data-placeholder"];
        const original = new Map(attributes.map((name) => [name, title.getAttribute(name)]));
        const entry = { title, composing: false, editing: false };
        const rememberSelection = () => {
            if (!view.file) return;
            const record = this.record(view.file);
            if (record.value.text === title.textContent) record.value = { ...record.value, ...this.selection(title) };
        };
        const input = () => this.input(view);
        const blur = () => {
            // Native blur-based renaming would race the serialized, live rename queue.
            if (!entry.composing) input();
            view.fileBeingRenamed = null;
        };
        const keydown = (event) => {
            if (event.isComposing || !["Enter", "Tab", "Escape"].includes(event.key)) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            input();
            title.blur();
            view.editor?.focus();
        };
        const beforeinput = (event) => {
            rememberSelection();
            if (event.inputType.startsWith("format")) { event.preventDefault(); return; }
            entry.editing = true;
        };
        const keyup = () => {
            if (entry.editing && !entry.composing) input();
            rememberSelection();
        };
        const compositionStart = () => { rememberSelection(); entry.composing = true; };
        const compositionEnd = () => { entry.composing = false; input(); };
        const listeners = [["input", input, true], ["blur", blur, true], ["keydown", keydown, true],
            ["beforeinput", beforeinput, true], ["keyup", keyup], ["pointerup", rememberSelection],
            ["compositionstart", compositionStart], ["compositionend", compositionEnd]];
        for (const [event, listener, capture = false] of listeners) title.addEventListener(event, listener, capture);
        const observer = new title.ownerDocument.defaultView.MutationObserver(() => this.sync(view));
        observer.observe(view.containerEl, { attributes: true, attributeFilter: ["data-mode"] });
        observer.observe(title, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ["contenteditable"] });
        entry.cleanup = () => {
            observer.disconnect();
            for (const [event, listener, capture = false] of listeners) title.removeEventListener(event, listener, capture);
            title.classList.remove("pw-note-title");
            for (const [name, value] of original) {
                if (value === null) title.removeAttribute(name);
                else title.setAttribute(name, value);
            }
            if (view.file) title.textContent = view.file.basename;
        };
        this.entries.set(view, entry);
    }

    dispose() {
        this.disposed = true;
        for (const entry of this.entries.values()) entry.cleanup();
        this.entries.clear();
    }
}

export { NoteTitle };
