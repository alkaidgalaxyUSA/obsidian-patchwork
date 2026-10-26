import { codeAttributes } from "./utils/note-code-block.js";

class NoteCodeBody {
    constructor(controller, outer, block) {
        this.controller = controller;
        this.outer = outer;
        this.block = block;
        this.dom = outer.dom.ownerDocument.createElement("div");
        this.dom.className = "pw-note-code-body";
        this.dom.contentEditable = "false";
        this.win = this.dom.ownerDocument.defaultView;
        this.refreshAttributes();
        this.view = new controller.EditorView({
            parent: this.dom,
            root: outer.root,
            state: controller.EditorState.create({
                doc: outer.state.doc.sliceString(block.contentFrom, block.contentTo),
                extensions: this.extensions(),
            }),
            dispatchTransactions: (transactions) => this.dispatch(transactions),
        });
        this.listeners = new this.win.AbortController();
        const options = { signal: this.listeners.signal };
        this.view.scrollDOM.addEventListener("wheel", (event) => this.wheel(event), { ...options, passive: false });
        this.view.contentDOM.addEventListener("focus", () => this.forwardSelection(), options);
        this.observer = new this.win.ResizeObserver(() => {
            this.view.requestMeasure();
            outer.plugin(controller.controlsPlugin)?.schedule();
        });
        this.observer.observe(this.dom);
        this.schedule();
    }

    extensions() {
        const api = this.controller;
        const forward = (command) => () => {
            this.forwardSelection();
            const handled = command(this.outer);
            this.sync();
            return handled;
        };
        this.configuration = `${this.block.opening}:${this.outer.state.readOnly}`;
        return [
            api.EditorState.readOnly.of(this.outer.state.readOnly),
            api.EditorView.editable.of(!this.outer.state.readOnly),
            api.EditorState.allowMultipleSelections.of(true),
            api.EditorState.tabSize.of(this.block.options.unit),
            this.block.options.wrap ? api.EditorView.lineWrapping : [],
            api.EditorView.contentAttributes.of({ "aria-label": "Code block content", spellcheck: "false" }),
            api.EditorView.decorations.of((view) => this.decorations(view.state)),
            api.keymap.of([
                { key: "Mod-z", run: forward(api.undo), preventDefault: true },
                { key: "Mod-Shift-z", run: forward(api.redo), preventDefault: true },
                { key: "Mod-y", run: forward(api.redo), preventDefault: true },
                { key: "Enter", run: forward((view) => api.enter(view)) },
                { key: "Backspace", run: () => this.view.state.selection.ranges.length === 1
                    && this.view.state.selection.main.empty && this.view.state.selection.main.head === 0
                    && api.removeBlankBeforeCode(this.outer, this.block, true) },
                { key: "Tab", run: forward((view) => api.indent(view, false)) },
                { key: "Shift-Tab", run: forward((view) => api.indent(view, true)) },
                { key: "ArrowLeft", run: forward((view) => api.leaveBlockSide(view, true)) },
                { key: "ArrowRight", run: forward((view) => api.leaveBlockSide(view, false)) },
                { key: "ArrowUp", run: () => this.leaveVertical(true) },
                { key: "ArrowDown", run: () => this.leaveVertical(false) },
                ...api.defaultKeymap,
            ]),
        ];
    }

    decorations(state) {
        const api = this.controller;
        const ranges = [];
        if (this.block.options.lineNumbers) {
            for (let number = 1; number <= state.doc.lines; number++) {
                ranges.push(api.Decoration.line({ attributes: { "data-pw-line-number": String(number) } }).range(state.doc.line(number).from));
            }
        }
        // Reuse the note's language parser and token classes; keep a single Markdown source.
        const { contentFrom, contentTo } = this.block;
        if (this.outer.state.doc.sliceString(contentFrom, contentTo) === state.doc.toString()) {
            const tree = api.syntaxTree(this.outer.state);
            const before = ranges.length;
            api.highlightTree(tree, {
                style: (tags) => api.highlightingFor(this.outer.state, tags),
            }, (from, to, className) => {
                from = Math.max(from, contentFrom) - contentFrom;
                to = Math.min(to, contentTo) - contentFrom;
                if (from < to) ranges.push(api.Decoration.mark({ class: className }).range(from, to));
            }, contentFrom, contentTo);
            // Obsidian's legacy mode parser stores token classes in node names,
            // rather than Lezer highlight tags. Preserve those native classes too.
            if (ranges.length === before) tree.iterate({ from: contentFrom, to: contentTo, enter: (node) => {
                const tokens = node.name.split("_");
                if (!tokens.includes("hmd-codeblock") || !tokens.every((token) => /^[\w-]+$/.test(token))) return;
                const from = Math.max(node.from, contentFrom) - contentFrom;
                const to = Math.min(node.to, contentTo) - contentFrom;
                if (from < to) ranges.push(api.Decoration.mark({ class: tokens.map((token) => `cm-${token}`).join(" ") }).range(from, to));
            } });
        }
        return api.Decoration.set(ranges, true);
    }

    refreshAttributes() {
        for (const [key, value] of Object.entries(codeAttributes(this.block.options))) this.dom.setAttribute(key, value);
        this.dom.dataset.pwBlock = String(this.block.from);
        this.dom.style.setProperty("--pw-code-height", this.block.options.height ? `${Math.max(40, this.block.options.height)}px` : "auto");
    }

    selectionOutside(selection) {
        const api = this.controller;
        return api.EditorSelection.create(selection.ranges.map((range) => api.EditorSelection.range(
            range.anchor + this.block.contentFrom, range.head + this.block.contentFrom,
        )), selection.mainIndex);
    }

    forwardSelection() {
        if (this.destroyed || this.syncing) return;
        const selection = this.selectionOutside(this.view.state.selection);
        if (!selection.eq(this.outer.state.selection)) this.outer.dispatch({ selection });
    }

    dispatch(transactions) {
        for (const transaction of transactions) {
            this.view.update([transaction]);
            if (this.syncing || this.destroyed) continue;
            const changes = [];
            transaction.changes.iterChanges((from, to, _fromB, _toB, insert) => {
                changes.push({ from: this.block.contentFrom + from, to: this.block.contentFrom + to, insert });
            });
            if (!changes.length && !transaction.selection) continue;
            this.outer.dispatch({
                changes,
                selection: this.selectionOutside(transaction.newSelection),
                userEvent: transaction.annotation(this.controller.Transaction.userEvent),
            });
        }
        this.schedule();
    }

    schedule() {
        if (this.destroyed || this.frame) return;
        this.frame = this.win.requestAnimationFrame(() => { this.frame = undefined; this.sync(); });
    }

    sync() {
        if (this.destroyed || this.syncing) return;
        const block = this.outer.state.field(this.controller.field, false)?.blocks.find((entry) => entry.from === this.block.from);
        if (!block) return;
        this.block = block;
        const content = this.outer.state.doc.sliceString(block.contentFrom, block.contentTo);
        const selected = this.outer.state.selection;
        const inside = selected.ranges.every((range) => range.from >= block.contentFrom && range.to <= block.contentTo);
        const selection = inside ? this.controller.EditorSelection.create(selected.ranges.map((range) =>
            this.controller.EditorSelection.range(range.anchor - block.contentFrom, range.head - block.contentFrom)), selected.mainIndex) : undefined;
        const changed = content !== this.view.state.doc.toString();
        const moved = selection && !selection.eq(this.view.state.selection);
        const configuration = `${block.opening}:${this.outer.state.readOnly}`;
        const reconfigure = configuration !== this.configuration;
        const tree = this.controller.syntaxTree(this.outer.state);
        const highlightChanged = tree !== this.tree;
        this.tree = tree;
        this.syncing = true;
        try {
            if (reconfigure || this.dom.dataset.pwBlock !== String(block.from)) this.refreshAttributes();
            if (changed || moved || reconfigure || highlightChanged) this.view.dispatch({
                changes: changed ? { from: 0, to: this.view.state.doc.length, insert: content } : undefined,
                selection,
                effects: reconfigure ? this.controller.StateEffect.reconfigure.of(this.extensions()) : undefined,
                scrollIntoView: Boolean(moved && (this.view.hasFocus || this.outer.hasFocus)),
            });
            const active = this.dom.ownerDocument.activeElement;
            if (inside && active === this.outer.contentDOM) this.view.focus();
            else if (!inside && this.dom.contains(active)) this.outer.focus();
        } finally { this.syncing = false; }
    }

    leaveVertical(upwards) {
        const range = this.view.state.selection.main;
        if (!range.empty || this.view.state.selection.ranges.length !== 1) return false;
        const line = this.view.state.doc.lineAt(range.head);
        if (upwards ? line.from !== 0 : line.to !== this.view.state.doc.length) return false;
        const cursor = this.view.coordsAtPos(range.head);
        const edge = this.view.coordsAtPos(upwards ? line.from : line.to);
        if (cursor && edge && Math.abs(cursor.top - edge.top) > 2) return false;
        this.forwardSelection();
        const { from, to } = this.block;
        const anchor = upwards ? from - 1 : to + 1;
        if (anchor < 0 || anchor > this.outer.state.doc.length) {
            return this.outer.plugin(this.controller.controlsPlugin)?.focusEdge(this.block, upwards ? "left" : "right") ?? false;
        }
        this.outer.dispatch({ selection: { anchor }, scrollIntoView: true });
        this.outer.focus();
        return true;
    }

    wheel(event) {
        if (event.ctrlKey || event.metaKey || event.defaultPrevented) return;
        const scroll = this.view.scrollDOM;
        const horizontal = event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY);
        const overflow = horizontal ? scroll.scrollWidth - scroll.clientWidth : scroll.scrollHeight - scroll.clientHeight;
        if (overflow <= 1) return;
        const delta = horizontal ? event.deltaX || event.deltaY : event.deltaY;
        if (!delta) return;
        const unit = event.deltaMode === 1 ? this.block.options.font * 1.65 : event.deltaMode === 2 ? (horizontal ? scroll.clientWidth : scroll.clientHeight) : 1;
        event.preventDefault();
        event.stopPropagation();
        if (horizontal) scroll.scrollLeft += delta * unit;
        else scroll.scrollTop += delta * unit;
    }

    destroy() {
        this.destroyed = true;
        this.win.cancelAnimationFrame(this.frame);
        this.listeners.abort();
        this.observer.disconnect();
        this.view.destroy();
        this.controller.bodies.delete(this.dom);
    }
}

export { NoteCodeBody };
