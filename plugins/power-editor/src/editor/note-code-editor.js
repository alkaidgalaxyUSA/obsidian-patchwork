import { LANGUAGES, THEMES, scanCodeBlocks, updateOpening, codeAttributes } from "./utils/note-code-block.js";
import { NoteCodeMenus } from "./note-code-menus.js";
import { wrapCodeLines, unwrapCodeLines } from "./utils/code-lines.js";
import { NoteCodeControls } from "./note-code-controls.js";
import { NoteCodeBody } from "./note-code-body.js";
import { NoteCodeActions } from "./note-code-actions.js";
import { highlightCode } from "./utils/code-highlighting.js";

class NoteCodeEditor {
    constructor(plugin, api) {
        this.plugin = plugin;
        this.app = plugin.app;
        Object.assign(this, api);
        this.menus = new NoteCodeMenus(api);
        this.actions = new NoteCodeActions(this);
        this.bindings = new WeakMap();
        this.bodies = new WeakMap();
        this.readingChildren = new Set();
        this.readingHeadingSections = new WeakSet();
        this.foldEffect = this.StateEffect.define({ map: (value, changes) => ({ ...value, from: changes.mapPos(value.from) }) });
        this.pendingEffect = this.StateEffect.define({ map: (value, changes) => ({ ...value, from: changes.mapPos(value.from) }) });
        this.headerEffect = this.StateEffect.define({ map: (value, changes) => ({ ...value, from: changes.mapPos(value.from) }) });
        this.field = this.StateField.define({
            create: (state) => this.buildState(state, scanCodeBlocks(state.doc), new Set(), new Set(), new Set()),
            update: (previous, transaction) => {
                const blocks = transaction.docChanged ? scanCodeBlocks(transaction.state.doc) : previous.blocks;
                const folded = new Set([...previous.folded].map((from) => transaction.changes.mapPos(from)));
                const pending = new Set([...previous.pending].map((from) => transaction.changes.mapPos(from, -1)));
                const hiddenHeaders = new Set([...previous.hiddenHeaders].map((from) => transaction.changes.mapPos(from)));
                for (const effect of transaction.effects) {
                    if (effect.is(this.headerEffect)) {
                        if (effect.value.hidden) hiddenHeaders.add(effect.value.from);
                        else hiddenHeaders.delete(effect.value.from);
                    }
                    if (effect.is(this.pendingEffect)) {
                        if (effect.value.pending) pending.add(effect.value.from);
                        else pending.delete(effect.value.from);
                    }
                    if (!effect.is(this.foldEffect)) continue;
                    if (effect.value.folded) folded.add(effect.value.from);
                    else folded.delete(effect.value.from);
                }
                for (const from of folded) {
                    const block = blocks.find((entry) => entry.from === from);
                    if (!block) { folded.delete(from); continue; }
                    // Search, undo and keyboard navigation must never strand a cursor in hidden code.
                    if (transaction.selection && transaction.state.selection.ranges.some((range) => range.head > from && range.head <= block.to)) folded.delete(from);
                }
                for (const from of pending) if (!blocks.some((block) => block.from === from)) pending.delete(from);
                for (const from of hiddenHeaders) if (!blocks.some((block) => block.from === from)) hiddenHeaders.delete(from);
                return this.buildState(transaction.state, blocks, folded, pending, hiddenHeaders);
            },
            provide: (field) => this.EditorView.decorations.from(field, (value) => value.decorations),
        });
        this.controlsPlugin = this.ViewPlugin.define((view) => new NoteCodeControls(this, view));
        plugin.registerEditorExtension([
            this.Prec.highest(this.field),
            this.controlsPlugin,
            this.EditorView.atomicRanges.of((view) => view.state.field(this.field, false)?.headingMarkers ?? this.Decoration.none),
            this.Prec.highest(this.keymap.of([
                { key: "`", run: (view) => this.typeFenceTrigger(view) },
                { key: "Enter", run: (view) => this.enter(view) },
                { key: "Backspace", run: (view) => this.exitEmptyHeading(view) || this.protectDelete(view, true) },
                { key: "Mod-Backspace", run: (view) => this.protectDelete(view, true) },
                { key: "Delete", run: (view) => this.protectDelete(view, false) },
                { key: "Mod-Delete", run: (view) => this.protectDelete(view, false) },
                { key: "ArrowUp", run: (view) => this.leaveBlock(view, true) },
                { key: "ArrowDown", run: (view) => this.leaveBlock(view, false) },
                { key: "ArrowLeft", run: (view) => this.leaveBlockSide(view, true) },
                { key: "ArrowRight", run: (view) => this.leaveBlockSide(view, false) },
                { key: "Tab", run: (view) => this.indent(view, false) },
                { key: "Shift-Tab", run: (view) => this.indent(view, true) },
            ])),
            this.EditorState.changeFilter.of((transaction) => this.filterDeletion(transaction)),
            this.EditorState.transactionFilter.of((transaction) => this.keepCursorInCode(transaction)),
            this.EditorState.transactionFilter.of((transaction) => this.keepCursorInHeading(transaction)),
        ]);
        plugin.registerMarkdownPostProcessor((element, context) => this.enhanceReading(element, context));
    }

    isLive(state) { return Boolean(state.field(this.editorLivePreviewField, false)); }

    isReady(block) {
        return block.endLine > block.startLine && block.contentFrom > block.openTo
            && (block.closeFrom === undefined || block.closeFrom > block.contentFrom);
    }

    isManaged(block) {
        return !["mermaid", "query", "math"].includes(block.options.language)
            && !this.MarkdownPreviewRenderer.codeBlockPostProcessors?.[block.options.language];
    }

    buildState(state, blocks, folded, pending, hiddenHeaders) {
        if (!this.isLive(state)) {
            const lines = [];
            for (const block of blocks) {
                if (!this.isManaged(block)) continue;
                for (let number = block.startLine; number <= block.endLine; number++) {
                    lines.push(this.Decoration.line({ attributes: { ...codeAttributes(block.options), class: "pw-code-source-line" } }).range(state.doc.line(number).from));
                }
            }
            return { blocks, folded, pending, hiddenHeaders, headingMarkers: this.Decoration.none, decorations: this.Decoration.set(lines, true) };
        }
        const decorations = [];
        const headings = this.headingDecorations(state, blocks, decorations);
        decorations.push(...headings);
        for (const block of blocks) {
            // Leave plugin-owned blocks (diagrams, queries, embeds) to their own renderer.
            if (!this.isManaged(block)) continue;
            if (!this.isReady(block) || pending.has(block.from)) {
                for (let number = block.startLine; number <= block.endLine; number++) {
                    decorations.push(this.Decoration.line({ class: "pw-note-code-trigger" }).range(state.doc.line(number).from));
                }
                continue;
            }
            const widget = new this.HeaderWidget(this, block, folded.has(block.from), hiddenHeaders.has(block.from));
            if (folded.has(block.from)) {
                decorations.push(this.Decoration.replace({ widget, inclusive: false }).range(block.from, block.to));
                decorations.push(this.Decoration.line({ attributes: {
                    ...codeAttributes(block.options), "data-pw-block": String(block.from), class: "pw-note-code-line pw-note-code-opening",
                } }).range(block.from));
                continue;
            }
            decorations.push(this.Decoration.replace({ widget, inclusive: false }).range(block.from, block.openTo));
            decorations.push(this.Decoration.replace({ widget: new this.BodyWidget(this, block, state), block: true }).range(block.contentFrom, block.contentTo));
            if (block.closeFrom !== undefined) {
                decorations.push(this.Decoration.replace({ inclusive: false }).range(block.closeFrom, block.to));
            }
            const fenceLines = block.closeFrom === undefined ? [block.startLine] : [block.startLine, block.endLine];
            for (const number of fenceLines) {
                const line = state.doc.line(number);
                const attributes = codeAttributes(block.options);
                attributes.class = `pw-note-code-line ${number === block.startLine ? "pw-note-code-opening" : "pw-note-code-closing"}`;
                attributes["data-pw-block"] = String(block.from);
                decorations.push(this.Decoration.line({ attributes }).range(line.from));
            }
        }
        return { blocks, folded, pending, hiddenHeaders, headingMarkers: this.Decoration.set(headings), decorations: this.Decoration.set(decorations, true) };
    }

    headingDecorations(state, blocks, decorations) {
        const headings = [];
        const fences = new Map(blocks.map((block) => [block.startLine, block.endLine]));
        let frontmatter = state.doc.line(1).text === "---";
        for (let number = 1; number <= state.doc.lines; number++) {
            const line = state.doc.line(number);
            if (frontmatter) {
                if (number > 1 && /^(---|\.\.\.)\s*$/.test(line.text)) frontmatter = false;
                continue;
            }
            if (fences.has(number)) { number = fences.get(number); continue; }
            if (/^ {0,3}#{1,6}$/.test(line.text)) {
                decorations.push(this.Decoration.line({ class: "pw-heading-pending" }).range(line.from));
                continue;
            }
            const prefix = line.text.match(/^( {0,3})#{1,6}[\t ]+/);
            if (prefix) headings.push(this.Decoration.replace({ inclusive: false }).range(line.from + prefix[1].length, line.from + prefix[0].length));
        }
        return headings;
    }

    keepCursorInHeading(transaction) {
        if (transaction.isUserEvent("undo") || transaction.isUserEvent("redo")) return transaction;
        if (!this.isLive(transaction.state)) return transaction;
        const markers = transaction.state.field(this.field, false)?.headingMarkers;
        if (!markers) return transaction;
        let changed = false;
        const ranges = transaction.newSelection.ranges.map((range) => {
            if (!range.empty) return range;
            let head = range.head;
            markers.between(head, head, (from, to) => { if (head >= from && head < to) head = to; });
            if (head === range.head) return range;
            changed = true;
            return this.EditorSelection.cursor(head);
        });
        return changed ? [transaction, { selection: this.EditorSelection.create(ranges, transaction.newSelection.mainIndex), sequential: true }] : transaction;
    }

    createEditorHeader(view, block, folded, headerHidden) {
        const header = this.createHeader(view.dom.ownerDocument);
        this.updateEditorHeader(header, view, block, folded, headerHidden);
        return header;
    }

    createEditorBody(view, block) {
        const body = new NoteCodeBody(this, view, block);
        this.bodies.set(body.dom, body);
        return body.dom;
    }

    updateEditorBody(dom, block) {
        const body = this.bodies.get(dom);
        if (!body) return false;
        body.block = block;
        // Reconcile after the outer editor finishes its update, avoiding nested dispatch.
        body.schedule();
        return true;
    }

    updateEditorHeader(header, view, block, folded, headerHidden) {
        this.bindings.set(header, {
            getBlock: () => view.state.field(this.field).blocks.find((entry) => entry.from === Number(header.dataset.from)),
            perform: (action, value) => this.actions.run(view, header, action, value),
            toggleHeader: () => {
                const current = this.bindings.get(header)?.getBlock();
                if (!current) return;
                this.menus.closeForHeader(header);
                view.dispatch({ effects: this.headerEffect.of({ from: current.from, hidden: !view.state.field(this.field).hiddenHeaders.has(current.from) }) });
                view.requestMeasure();
                view.plugin(this.controlsPlugin)?.schedule();
            },
            update: (key, value) => {
                const current = this.bindings.get(header).getBlock();
                if (!current || view.state.readOnly) return;
                view.dispatch({ changes: { from: current.from, to: current.openTo, insert: updateOpening(current, key, value) }, userEvent: "input" });
            },
            copy: () => {
                const current = this.bindings.get(header).getBlock();
                return current ? view.state.doc.sliceString(current.contentFrom, current.contentTo) : "";
            },
            fold: () => {
                const current = this.bindings.get(header).getBlock();
                if (!current) return;
                const isFolded = view.state.field(this.field).folded.has(current.from);
                view.dispatch({
                    effects: this.foldEffect.of({ from: current.from, folded: !isFolded }),
                    selection: { anchor: isFolded ? current.contentFrom : current.from },
                });
                if (isFolded) view.focus();
            },
            focus: () => {
                const current = this.bindings.get(header)?.getBlock();
                if (!current) return;
                view.dispatch({ selection: { anchor: Math.min(current.contentFrom, current.contentTo) } });
                view.focus();
            },
            paragraph: () => {
                const current = this.bindings.get(header)?.getBlock();
                if (!current) return;
                const insert = `${current.closeFrom === undefined ? `\n${current.prefix}${current.fence}` : ""}\n\n`;
                view.dispatch({ changes: { from: current.to, insert }, selection: { anchor: current.to + insert.length }, userEvent: "input" });
                view.focus();
            },
            remove: () => {
                const current = this.bindings.get(header)?.getBlock();
                if (!current) return;
                view.dispatch({ changes: { from: current.from, to: Math.min(current.to + 1, view.state.doc.length) }, selection: { anchor: current.from }, userEvent: "delete.code-block" });
                view.focus();
            },
        });
        header.dataset.from = String(block.from);
        this.refreshHeader(header, block.options, folded, headerHidden);
        return true;
    }

    createHeader(doc, reading = false) {
        this.menus.observeTooltips(doc);
        const header = doc.createElement("div");
        header.className = "pw-note-code-header";
        header.dataset.mode = reading ? "reading" : "editing";
        header.contentEditable = "false";
        header.setAttribute("role", "group");
        header.setAttribute("aria-label", "Code block settings");
        const button = (action, label, icon) => {
            const element = doc.createElement("button");
            element.type = "button";
            element.dataset.action = action;
            element.setAttribute("aria-label", label);
            if (label === "adaptive width display") element.dataset.tooltipPosition = "top";
            this.setIcon(element, icon);
            header.append(element);
            return element;
        };
        button("fold", reading ? "Fold" : "Collapse code block", "chevron-down");
        const name = doc.createElement(reading ? "span" : "input");
        if (!reading) {
            name.type = "text";
            name.placeholder = "please input name";
            name.readOnly = true;
            name.addEventListener("focus", () => { name.readOnly = false; });
            name.addEventListener("blur", () => { name.readOnly = true; });
        }
        name.setAttribute("aria-label", "Code block name");
        name.maxLength = 200;
        name.className = "pw-note-code-name";
        header.append(name);
        const select = (key, label) => {
            const element = doc.createElement("button");
            element.type = "button";
            element.className = "pw-code-select";
            element.dataset.setting = key;
            element.setAttribute("aria-label", label);
            element.setAttribute("aria-haspopup", "dialog");
            element.setAttribute("aria-expanded", "false");
            const value = doc.createElement("span");
            value.className = "pw-code-select-value";
            const icon = doc.createElement("span");
            icon.setAttribute("aria-hidden", "true");
            this.setIcon(icon, "chevrons-up-down");
            element.append(value, icon);
            header.append(element);
        };
        const separator = () => {
            const element = doc.createElement("span");
            element.className = "pw-note-code-separator";
            element.setAttribute("aria-hidden", "true");
            element.textContent = "|";
            header.append(element);
        };
        if (reading) {
            const language = doc.createElement("span");
            language.className = "pw-code-reading-language";
            header.append(language);
        } else {
            select("language", "Code language");
            separator();
            select("theme", "Code theme");
        }
        separator();
        const copy = button("copy", "Copy code", "copy");
        copy.classList.add("pw-code-copy");
        if (reading) {
            copy.append(doc.createTextNode("Copy"));
            const wide = button("width", "adaptive width display", "arrow-left-right");
            wide.classList.add("pw-code-reading-wide");
            const rail = doc.createElement("div");
            rail.className = "pw-code-reading-rail";
            rail.append(wide);
            header.append(rail);
        } else {
            separator();
            button("more", "More code settings", "ellipsis").setAttribute("aria-haspopup", "dialog");
            button("toggle-header", "Hide code block header", "chevron-up").classList.add("pw-code-header-toggle");
        }
        header.addEventListener("pointerdown", (event) => event.stopPropagation());
        header.addEventListener("change", (event) => {
            const key = event.target === name ? "name" : event.target.dataset.setting;
            if (key && !reading) this.bindings.get(header)?.update?.(key, event.target.value);
        });
        name.addEventListener("keydown", (event) => {
            event.stopPropagation();
            if (event.key === "Enter" && !event.isComposing) {
                event.preventDefault();
                name.blur();
                this.bindings.get(header)?.focus?.();
            }
            if (event.key === "Escape") {
                name.value = this.bindings.get(header)?.getBlock()?.options.name ?? "";
                name.blur();
                this.bindings.get(header)?.focus?.();
            }
        });
        header.addEventListener("click", (event) => {
            event.stopPropagation();
            const select = event.target.closest("button[data-setting]");
            if (select) { this.menus.open(header, select, this.bindings.get(header), select.dataset.setting); return; }
            const action = event.target.closest("button[data-action]")?.dataset.action;
            const binding = this.bindings.get(header);
            if (!action || !binding) return;
            if (action === "fold") binding.fold();
            if (action === "width") binding.toggleWidth?.();
            if (action === "toggle-header") binding.toggleHeader();
            if (action === "more") this.menus.open(header, header.querySelector('[data-action="more"]'), binding);
            if (action === "copy") {
                doc.defaultView.navigator.clipboard.writeText(binding.copy()).then(
                    () => this.menus.showCopied(doc),
                    () => new this.Notice("Could not copy code"),
                );
            }
        });
        return header;
    }

    refreshHeader(header, options, folded, headerHidden = false) {
        for (const [key, value] of Object.entries(codeAttributes(options))) header.setAttribute(key, value);
        const input = header.querySelector("input");
        if (input && input !== header.ownerDocument.activeElement) input.value = options.name;
        if (header.dataset.mode === "reading") {
            const name = header.querySelector(".pw-note-code-name");
            name.textContent = options.name;
            name.hidden = !options.name;
            header.querySelector(".pw-code-reading-language").textContent = LANGUAGES.find(([key]) => key === options.language)?.[1] ?? options.language;
            header.querySelector('[data-action="width"]').setAttribute("aria-pressed", String(options.width === "wide"));
        }
        for (const select of header.querySelectorAll("button[data-setting]")) {
            const value = options[select.dataset.setting];
            const choices = select.dataset.setting === "language" ? LANGUAGES : THEMES;
            select.querySelector(".pw-code-select-value").textContent = choices.find(([key]) => key === value)?.[1] ?? value;
        }
        const fold = header.querySelector('[data-action="fold"]');
        header.dataset.collapsed = String(folded);
        this.setIcon(fold, folded ? "chevron-right" : "chevron-down");
        fold.setAttribute("aria-label", header.dataset.mode === "reading" ? (folded ? "Unfold" : "Fold") : (folded ? "Expand code block" : "Collapse code block"));
        fold.setAttribute("aria-expanded", String(!folded));
        const hidden = headerHidden && !folded;
        header.dataset.headerHidden = String(hidden);
        const toggle = header.querySelector('[data-action="toggle-header"]');
        if (!toggle) return;
        toggle.setAttribute("aria-label", hidden ? "Show code block header" : "Hide code block header");
        toggle.setAttribute("aria-expanded", String(!hidden));
        this.setIcon(toggle, hidden ? "chevron-down" : "chevron-up");
    }

    protectedBlocks(state) {
        const value = state.field(this.field, false);
        return (value?.blocks ?? []).filter((block) => this.isManaged(block) && this.isReady(block) && !value.pending.has(block.from));
    }

    touchesFence(block, from, to, length) {
        return from < block.contentFrom && to > Math.max(0, block.from - 1)
            || block.closeFrom !== undefined && from < Math.min(length, block.to + 1) && to > block.contentTo;
    }

    blankBeforeCode(doc, block) {
        if (block.startLine <= 1) return;
        const line = doc.line(block.startLine - 1);
        return line.text.trim() ? undefined : line;
    }

    removeBlankBeforeCode(view, block, backwards) {
        if (view.state.readOnly || view.composing || !this.isLive(view.state)) return false;
        const current = this.protectedBlocks(view.state).find((entry) => entry.from === block.from);
        const line = current && this.blankBeforeCode(view.state.doc, current);
        if (!line) return false;
        // Map the existing caret without requesting a scroll into the tall code widget.
        view.dispatch({ changes: { from: line.from, to: current.from }, userEvent: backwards ? "delete.backward" : "delete.forward" });
        const moved = this.protectedBlocks(view.state).find((entry) => entry.from === line.from);
        if (!moved || !view.plugin(this.controlsPlugin)?.focusEdge(moved, "left")) view.focus();
        return true;
    }

    filterDeletion(transaction) {
        if (!this.isLive(transaction.startState) || !["delete.backward", "delete.forward", "delete.selection"].some((event) => transaction.isUserEvent(event))) return true;
        const blocks = this.protectedBlocks(transaction.startState);
        let allowed = true;
        transaction.changes.iterChangedRanges((from, to, fromB, toB) => {
            if (blocks.some((block) => {
                if (!this.touchesFence(block, from, to, transaction.startState.doc.length)) return false;
                const blank = this.blankBeforeCode(transaction.startState.doc, block);
                return !(blank && from === blank.from && to === block.from && fromB === toB);
            })) allowed = false;
        });
        return allowed;
    }

    protectDelete(view, backwards) {
        if (!this.isLive(view.state)) return false;
        if (!backwards && view.state.selection.ranges.length === 1 && view.state.selection.main.empty) {
            const line = view.state.doc.lineAt(view.state.selection.main.head);
            const next = this.protectedBlocks(view.state).find((block) => block.startLine === line.number + 1);
            if (next && this.removeBlankBeforeCode(view, next, false)) return true;
        }
        const blocks = this.protectedBlocks(view.state);
        return view.state.selection.ranges.some((range) => {
            const from = range.empty && backwards ? Math.max(0, range.from - 1) : range.from;
            const to = range.empty && !backwards ? Math.min(view.state.doc.length, range.to + 1) : range.to;
            return blocks.some((block) => this.touchesFence(block, from, to, view.state.doc.length));
        });
    }

    keepCursorInCode(transaction) {
        if (transaction.isUserEvent("undo") || transaction.isUserEvent("redo")) return transaction;
        const withBody = this.ensureCodeBody(transaction);
        if (withBody) return withBody;
        if (!transaction.selection || !this.isLive(transaction.startState) || transaction.effects.some((effect) => effect.is(this.foldEffect) || effect.is(this.pendingEffect))) return transaction;
        const blocks = transaction.docChanged ? scanCodeBlocks(transaction.newDoc) : this.protectedBlocks(transaction.startState);
        const folded = transaction.startState.field(this.field, false)?.folded;
        let changed = false;
        const ranges = transaction.newSelection.ranges.map((range) => {
            if (!range.empty) return range;
            const block = blocks.find((entry) => this.isReady(entry) && this.isManaged(entry)
                && !transaction.startState.field(this.field, false)?.pending.has(entry.from)
                && range.head >= entry.from && range.head <= entry.to);
            if (!block || folded?.has(block.from)) return range;
            const head = range.head <= block.openTo ? block.contentFrom : range.head > block.contentTo ? block.contentTo : range.head;
            if (head === range.head) return range;
            changed = true;
            return this.EditorSelection.cursor(head);
        });
        return changed ? [transaction, { selection: this.EditorSelection.create(ranges, transaction.newSelection.mainIndex), sequential: true }] : transaction;
    }

    ensureCodeBody(transaction) {
        if (!this.isLive(transaction.startState) || (!transaction.docChanged && !transaction.selection)) return;
        if (transaction.isUserEvent("undo") || transaction.isUserEvent("redo")
            || transaction.effects.some((effect) => effect.is(this.pendingEffect) && effect.value.pending)) return;
        const candidates = transaction.docChanged ? scanCodeBlocks(transaction.newDoc) : transaction.startState.field(this.field, false)?.blocks ?? [];
        const blocks = candidates.filter((block) => block.closeFrom === block.contentFrom && this.isManaged(block)
            && !transaction.startState.field(this.field, false)?.pending.has(block.from)
            && transaction.newSelection.ranges.some((range) => range.empty && range.head >= block.from && range.head <= block.to));
        if (!blocks.length) return;
        const insertions = blocks.map((block) => ({ from: block.contentFrom, insert: `${block.prefix}\n` }));
        const changeSet = this.ChangeSet.of(insertions, transaction.newDoc.length);
        const ranges = transaction.newSelection.ranges.map((range) => {
            const block = blocks.find((entry) => range.empty && range.head >= entry.from && range.head <= entry.to);
            return block ? this.EditorSelection.cursor(changeSet.mapPos(block.contentFrom, -1) + block.prefix.length) : range.map(changeSet);
        });
        return [transaction, {
            changes: changeSet,
            selection: this.EditorSelection.create(ranges, transaction.newSelection.mainIndex),
            effects: blocks.map((block) => this.pendingEffect.of({ from: changeSet.mapPos(block.from), pending: false })),
            sequential: true,
        }];
    }

    headingLine(view) {
        const { state } = view;
        if (!this.isLive(state) || state.readOnly || view.composing || state.selection.ranges.length !== 1 || !state.selection.main.empty) return;
        const position = state.selection.main.head;
        if (state.field(this.field, false)?.blocks.some((block) => position >= block.from && position <= block.to)) return;
        const line = state.doc.lineAt(position);
        const { node } = view.domAtPos(line.from);
        const element = node.nodeType === 1 ? node : node.parentElement;
        if (element.closest(".HyperMD-codeblock, .HyperMD-frontmatter")) return;
        return line;
    }

    exitEmptyHeading(view) {
        const line = this.headingLine(view);
        if (!line) return false;
        if (!/^ {0,3}#{1,6}[\t ]+$/.test(line.text)) {
            const prefix = line.text.match(/^ {0,3}#{1,6}[\t ]+/);
            return Boolean(prefix && view.state.selection.main.head <= line.from + prefix[0].length);
        }
        view.dispatch({ changes: { from: line.from, to: line.to }, selection: { anchor: line.from }, userEvent: "delete.backward" });
        return true;
    }

    typeFenceTrigger(view) {
        if (!this.isLive(view.state) || view.state.readOnly || view.composing || view.state.selection.ranges.length !== 1) return false;
        const position = view.state.selection.main.head;
        if (this.protectedBlocks(view.state).some((block) => position > block.openTo && position <= block.to)) return false;
        const line = view.state.doc.lineAt(position);
        const before = line.text.slice(0, position - line.from);
        const after = line.text.slice(position - line.from);
        // Only a fence-only line uses delayed creation; inline code stays native Markdown.
        const range = view.state.selection.main;
        if (!range.empty || !/^ {0,3}`*$/.test(before) || after.trim()) return false;
        const pending = range.empty && /^ {0,3}`{2,}$/.test(before) && !after.trim();
        view.dispatch({ changes: { from: range.from, to: range.to, insert: "`" }, selection: { anchor: range.from + 1 },
            effects: pending ? this.pendingEffect.of({ from: line.from, pending: true }) : undefined, userEvent: "input.type" });
        return true;
    }

    leaveBlockSide(view, left) {
        if (!this.isLive(view.state) || view.state.selection.ranges.length !== 1 || !view.state.selection.main.empty) return false;
        const position = view.state.selection.main.head;
        const block = this.protectedBlocks(view.state).find((entry) => position === (left ? entry.contentFrom : entry.contentTo));
        return block ? view.plugin(this.controlsPlugin)?.focusEdge(block, left ? "left" : "right") ?? false : false;
    }

    exitEmptyQuote(view, line) {
        const match = line.text.match(/^( {0,3}(?:>[\t ]*)*)>[\t ]*$/);
        if (!match || view.state.selection.main.head <= line.from + line.text.lastIndexOf(">")) return false;
        const { node } = view.domAtPos(line.from);
        const element = node.nodeType === 1 ? node : node.parentElement;
        if (!element.closest(".HyperMD-quote:not(.HyperMD-codeblock)")) return false;
        // Exit one quote level on this line, without inserting another newline.
        const insert = match[1];
        view.dispatch({ changes: { from: line.from, to: line.to, insert }, selection: { anchor: line.from + insert.length }, scrollIntoView: true, userEvent: "input" });
        return true;
    }

    enter(view) {
        if (view.state.readOnly || view.composing || !this.isLive(view.state) || view.state.selection.ranges.length !== 1 || !view.state.selection.main.empty) return false;
        const position = view.state.selection.main.head;
        const line = view.state.doc.lineAt(position);
        if (this.exitEmptyQuote(view, line)) return true;
        const block = this.protectedBlocks(view.state).find((entry) => position >= entry.contentFrom && position <= entry.contentTo);
        if (!block) {
            const before = line.text.slice(0, position - line.from);
            const after = line.text.slice(position - line.from);
            const match = before.match(/^( {0,3})(```)[\t ]*$/);
            if (!match || (after.trim() && after.trim() !== match[2])) return false;
            const candidate = { options: { language: "" } };
            if (!this.isManaged(candidate)) return false;
            const existing = view.state.field(this.field).blocks.find((entry) => entry.from === line.from && entry.closeFrom !== undefined);
            if (existing) {
                const empty = existing.closeFrom === existing.contentFrom;
                view.dispatch({
                    changes: empty ? { from: existing.contentFrom, insert: `${existing.prefix}\n` } : undefined,
                    selection: { anchor: existing.contentFrom + (empty ? existing.prefix.length : 0) },
                    effects: this.pendingEffect.of({ from: existing.from, pending: false }),
                    scrollIntoView: true,
                    userEvent: "input",
                });
                view.focus();
                return true;
            }
            const insert = `${before}\n${match[1]}\n${match[1]}${match[2]}${line.to === view.state.doc.length ? "\n" : ""}`;
            view.dispatch({ changes: { from: line.from, to: line.to, insert }, selection: { anchor: line.from + before.length + 1 + match[1].length }, effects: this.pendingEffect.of({ from: line.from, pending: false }), scrollIntoView: true, userEvent: "input" });
            view.focus();
            return true;
        }
        const before = view.state.doc.sliceString(line.from, position);
        const after = view.state.doc.sliceString(position, line.to);
        const leading = block.options.autoIndent ? before.match(/^\s*/)[0] : "";
        const unit = block.options.indent === "tabs" ? "\t" : " ".repeat(block.options.unit);
        const opener = before.trimEnd().slice(-1);
        const extra = block.options.autoIndent && "{[(".includes(opener) && opener ? unit : "";
        const closer = { "{": "}", "[": "]", "(": ")" }[opener];
        const tail = extra && after.trimStart().startsWith(closer) ? `\n${leading}` : "";
        const insert = `\n${leading}${extra}${tail}`;
        view.dispatch({ changes: { from: position, insert }, selection: { anchor: position + 1 + leading.length + extra.length }, userEvent: "input" });
        return true;
    }

    leaveBlock(view, upwards) {
        if (!this.isLive(view.state) || view.state.selection.ranges.length !== 1 || !view.state.selection.main.empty) return false;
        const position = view.state.selection.main.head;
        const block = this.protectedBlocks(view.state).find((entry) => position >= entry.contentFrom && position <= entry.contentTo);
        if (!block) return false;
        const line = view.state.doc.lineAt(position);
        // Preserve normal navigation between wrapped visual lines.
        const cursor = view.coordsAtPos(position);
        const edge = view.coordsAtPos(upwards ? line.from : line.to);
        if (cursor && edge && Math.abs(cursor.top - edge.top) > 2) return false;
        if (upwards && line.from === block.contentFrom && block.from > 0) {
            view.dispatch({ selection: { anchor: block.from - 1 }, scrollIntoView: true });
            return true;
        }
        if (!upwards && line.to === block.contentTo && block.closeFrom !== undefined) {
            const atEnd = block.to === view.state.doc.length;
            view.dispatch({ changes: atEnd ? { from: block.to, insert: "\n" } : undefined, selection: { anchor: block.to + 1 }, scrollIntoView: true });
            return true;
        }
        return false;
    }

    indent(view, backwards) {
        if (!this.isLive(view.state) || view.state.selection.ranges.length !== 1) return false;
        const range = view.state.selection.main;
        const block = view.state.field(this.field).blocks.find((entry) => range.from >= entry.contentFrom && range.to <= entry.contentTo);
        if (!block || !this.isManaged(block)) return false;
        const unit = block.options.indent === "tabs" ? "\t" : " ".repeat(block.options.unit);
        if (range.empty && !backwards) {
            view.dispatch({ changes: { from: range.head, insert: unit }, selection: { anchor: range.head + unit.length }, userEvent: "input.indent" });
            return true;
        }
        const start = view.state.doc.lineAt(range.from).number;
        const end = view.state.doc.lineAt(Math.max(range.from, range.to - (range.empty ? 0 : 1))).number;
        const changes = [];
        for (let number = start; number <= end; number++) {
            const line = view.state.doc.line(number);
            if (!backwards) { changes.push({ from: line.from, insert: unit }); continue; }
            const leading = line.text.match(/^(\t| +)/)?.[0] ?? "";
            const length = Math.min(leading.length, leading.startsWith("\t") ? 1 : block.options.unit);
            if (length) changes.push({ from: line.from, to: line.from + length });
        }
        view.dispatch({ changes, userEvent: "input.indent" });
        return true;
    }

    enhanceReadingHeadings(element, context) {
        const selector = "h1, h2, h3, h4, h5, h6";
        if (this.readingHeadingSections.has(element) || !element.matches(selector) && !element.querySelector(selector)) return;
        this.readingHeadingSections.add(element);
        const originals = new Map();
        const refresh = () => {
            for (const icon of element.querySelectorAll(".heading-collapse-indicator")) {
                if (!originals.has(icon)) originals.set(icon, icon.getAttribute("aria-label"));
                icon.setAttribute("aria-label", icon.classList.contains("is-collapsed") ? "Unfold" : "Fold");
            }
        };
        const observer = new element.ownerDocument.defaultView.MutationObserver(refresh);
        observer.observe(element, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
        const child = new this.ReadingChild(element, () => {
            observer.disconnect();
            for (const [icon, label] of originals) {
                if (label === null) icon.removeAttribute("aria-label");
                else icon.setAttribute("aria-label", label);
            }
            this.readingHeadingSections.delete(element);
            this.readingChildren.delete(child);
        });
        this.readingChildren.add(child);
        context.addChild(child);
        refresh();
    }

    enhanceReading(element, context) {
        const scope = '.mod-root .workspace-leaf-content[data-type="markdown"]';
        if (!element.closest(scope) && !context.containerEl?.closest(scope)) { this.enhanceSyntax(element, context); return; }
        this.enhanceReadingHeadings(element, context);
        for (const pre of element.querySelectorAll("pre")) {
            if (pre.dataset.pwCode !== undefined || !pre.querySelector("code")) continue;
            const info = context.getSectionInfo(pre);
            if (!info) continue;
            const blocks = scanCodeBlocks(this.Text.of(info.text.split("\n")));
            let block = blocks.find((entry) => entry.startLine - 1 === info.lineStart);
            if (!block || !this.isManaged(block)) continue;
            const header = this.createHeader(pre.ownerDocument, true);
            const code = pre.querySelector("code");
            const previousStyle = pre.getAttribute("style");
            const previousHidden = pre.hidden;
            pre.before(header);
            const observer = new pre.ownerDocument.defaultView.MutationObserver(() => {
                if (block.options.lineNumbers) wrapCodeLines(code);
            });
            observer.observe(code, { childList: true, subtree: true });
            const resizeObserver = new pre.ownerDocument.defaultView.ResizeObserver(() => this.resizeReading(header, pre, block.options));
            const viewport = pre.closest(".markdown-preview-view") ?? pre.parentElement;
            resizeObserver.observe(viewport);
            resizeObserver.observe(pre);
            const child = new this.ReadingChild(header, () => {
                observer.disconnect();
                resizeObserver.disconnect();
                unwrapCodeLines(code);
                this.menus.closeForHeader(header);
                header.remove();
                pre.hidden = previousHidden;
                for (const attribute of ["data-pw-code", "data-pw-theme", "data-pw-wrap", "data-pw-lines", "data-pw-width", "data-pw-offset"]) pre.removeAttribute(attribute);
                if (previousStyle === null) pre.removeAttribute("style");
                else pre.setAttribute("style", previousStyle);
                this.readingChildren.delete(child);
            });
            this.readingChildren.add(child);
            context.addChild(child);
            const refresh = () => {
                this.refreshHeader(header, block.options, pre.hidden);
                for (const [key, value] of Object.entries(codeAttributes(block.options))) pre.setAttribute(key, value);
                this.resizeReading(header, pre, block.options);
                if (block.options.lineNumbers) wrapCodeLines(code);
                else unwrapCodeLines(code);
            };
            this.bindings.set(header, {
                getBlock: () => block,
                copy: () => pre.querySelector("code").textContent,
                fold: () => { pre.hidden = !pre.hidden; refresh(); },
                toggleWidth: () => {
                    block = { ...block, options: { ...block.options, width: block.options.width === "wide" ? "normal" : "wide" } };
                    refresh();
                },
            });
            refresh();
        }
        this.enhanceSyntax(element, context);
    }

    enhanceSyntax(element, context) {
        for (const code of element.querySelectorAll("pre > code")) {
            if (code.dataset.pwSyntax !== undefined) continue;
            const language = [...code.classList, ...code.parentElement.classList].find((name) => name.startsWith("language-"))?.slice(9) ?? "";
            if (!this.isManaged({ options: { language } })) continue;
            const pre = code.parentElement;
            const originalStyle = pre.getAttribute("style");
            const originalTheme = pre.getAttribute("data-pw-theme");
            const standalone = pre.dataset.pwCode === undefined;
            if (standalone) {
                const info = context.getSectionInfo(pre);
                const block = info && scanCodeBlocks(this.Text.of(info.text.split("\n"))).find((entry) => entry.startLine - 1 === info.lineStart);
                if (block) {
                    pre.dataset.pwTheme = block.options.theme;
                    pre.style.setProperty("--pw-code-size", `${block.options.font}px`);
                    pre.style.tabSize = String(block.options.unit);
                }
            }
            const original = code.innerHTML;
            const source = code.textContent;
            let previous;
            const render = () => {
                const unit = Number.parseInt(code.ownerDocument.defaultView.getComputedStyle(code.parentElement).tabSize, 10) || 4;
                previous = highlightCode(code, language, unit, previous);
            };
            code.dataset.pwSyntax = "editor";
            render();
            const observer = new code.ownerDocument.defaultView.MutationObserver(render);
            observer.observe(code, { childList: true, subtree: true, characterData: true });
            const child = new this.ReadingChild(code, () => {
                observer.disconnect();
                delete code.dataset.pwSyntax;
                if (code.textContent === source) code.innerHTML = original;
                if (standalone) {
                    if (originalStyle === null) pre.removeAttribute("style");
                    else pre.setAttribute("style", originalStyle);
                    if (originalTheme === null) pre.removeAttribute("data-pw-theme");
                    else pre.setAttribute("data-pw-theme", originalTheme);
                }
                this.readingChildren.delete(child);
            });
            this.readingChildren.add(child);
            context.addChild(child);
        }
    }

    resizeReading(header, pre, options) {
        const rail = header.querySelector(".pw-code-reading-rail");
        if (rail) rail.style.height = `${header.getBoundingClientRect().height + (pre.hidden ? 0 : pre.getBoundingClientRect().height)}px`;
        const container = pre.parentElement;
        const viewport = pre.closest(".markdown-preview-view");
        if (!container || !viewport) return;
        const content = container.getBoundingClientRect();
        const bounds = viewport.getBoundingClientRect();
        const expansion = options.width === "wide" ? Math.max(0, Math.min(content.left - bounds.left - 40, bounds.right - content.right - 40)) : 0;
        for (const element of [header, pre]) {
            element.style.marginLeft = `calc(var(--pw-code-offset, 0px) - ${expansion}px)`;
            element.style.width = `calc(100% - var(--pw-code-offset, 0px) + ${expansion * 2}px)`;
        }
    }

    dispose() {
        this.menus.dispose();
        for (const child of this.readingChildren) child.unload();
    }
}

export { NoteCodeEditor };
