import { updateOpening } from "./utils/note-code-block.js";
import { documentBlocks, moveCodeBlock } from "./utils/document-blocks.js";
import { NoteParagraphControls } from "./note-paragraph-controls.js";

let editorId = 0;

class NoteCodeControls {
    constructor(controller, view) {
        this.controller = controller;
        this.view = view;
        this.doc = view.dom.ownerDocument;
        this.controller.menus.observeTooltips(this.doc);
        this.win = this.doc.defaultView;
        this.entries = new Map();
        this.id = `pw-code-${++editorId}`;
        view.dom.dataset.pwEditor = this.id;
        this.layer = this.doc.createElement("div");
        this.layer.className = "pw-code-controls-layer";
        this.layer.contentEditable = "false";
        this.style = this.doc.createElement("style");
        view.dom.append(this.style, this.layer);
        this.paragraphs = new NoteParagraphControls(this);
        this.listeners = new this.win.AbortController();
        const options = { signal: this.listeners.signal };
        view.scrollDOM.addEventListener("scroll", () => this.schedule(), options);
        view.dom.addEventListener("pointermove", (event) => {
            const element = event.target.closest?.("[data-pw-block], .pw-note-code-header, .pw-code-controls");
            const margin = this.marginAt(event);
            this.hovered = element?.dataset.pwBlock ?? element?.dataset.from ?? margin?.entry.root.dataset.from ?? this.paragraphs.hoverAt(event);
            view.dom.classList.toggle("pw-code-margin-hover", Boolean(margin));
            this.schedule();
        }, options);
        view.dom.addEventListener("pointerdown", (event) => {
            if (event.button !== 0 || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey || view.state.readOnly) return;
            const margin = this.marginAt(event);
            const block = margin && this.current(margin.entry);
            if (!block) return;
            event.preventDefault();
            event.stopPropagation();
            this.focusEdge(block, margin.side);
        }, { ...options, capture: true });
        view.dom.addEventListener("pointerleave", () => {
            this.hovered = undefined;
            view.dom.classList.remove("pw-code-margin-hover");
            this.schedule();
        }, options);
        view.dom.addEventListener("focusin", () => this.schedule(), options);
        view.dom.addEventListener("focusout", () => this.schedule(), options);
        this.observer = new this.win.ResizeObserver(() => this.schedule());
        this.observer.observe(view.scrollDOM);
        this.schedule();
    }

    update(update) {
        if (update.docChanged) this.cancelGesture?.();
        this.schedule();
    }

    schedule() {
        if (this.destroyed || this.frame) return;
        this.frame = this.win.requestAnimationFrame(() => { this.frame = undefined; this.sync(); });
    }

    current(entry) {
        if (entry.paragraph) return this.paragraphs.current(entry);
        return this.view.state.field(this.controller.field, false)?.blocks.find((block) => block.from === Number(entry.root.dataset.from));
    }

    marginAt(event) {
        if (event.target.closest?.("button, input, select, textarea, a, .pw-code-controls, .pw-note-code-body, .cm-gutters")) return;
        const scroll = this.view.scrollDOM;
        const viewport = scroll.getBoundingClientRect();
        // Keep scrollbars and neighboring panes outside the text hit area.
        if (event.clientX < viewport.left + scroll.clientLeft || event.clientX >= viewport.left + scroll.clientLeft + scroll.clientWidth
            || event.clientY < viewport.top || event.clientY >= viewport.top + scroll.clientHeight) return;
        for (const entry of this.entries.values()) {
            const header = entry.header.getBoundingClientRect();
            const body = this.view.dom.querySelector(`.pw-note-code-body[data-pw-block="${entry.root.dataset.from}"]`);
            const bottom = body?.getBoundingClientRect().bottom ?? header.bottom;
            if (event.clientY < header.top || event.clientY > bottom) continue;
            if (event.clientX < header.left) return { entry, side: "left" };
            if (event.clientX > header.right) return { entry, side: "right" };
        }
    }

    button(root, className, label, icon) {
        const button = this.doc.createElement("button");
        button.type = "button";
        button.className = className;
        button.setAttribute("aria-label", label);
        if (["can drag and click", "adaptive width display"].includes(label)) button.dataset.tooltipPosition = "top";
        if (icon) this.controller.setIcon(button, icon);
        root.append(button);
        return button;
    }

    create(header, block) {
        const root = this.doc.createElement("div");
        root.className = "pw-code-controls";
        root.dataset.from = String(block.from);
        const grip = this.button(root, "pw-code-drag", "can drag and click");
        grip.setAttribute("aria-haspopup", "dialog");
        grip.setAttribute("aria-expanded", "false");
        this.controller.setIcon(grip, "code-drag");
        const wide = this.button(root, "pw-code-wide", "adaptive width display", "arrow-left-right");
        const resize = this.button(root, "pw-code-resize", "Resize code block height");
        resize.setAttribute("role", "separator");
        resize.setAttribute("aria-orientation", "horizontal");
        resize.setAttribute("aria-valuemin", "40");
        resize.setAttribute("aria-valuemax", "2000");
        const left = this.button(root, "pw-code-edge pw-code-edge-left", "Cursor before code block");
        const right = this.button(root, "pw-code-edge pw-code-edge-right", "Cursor after code block");
        const entry = { root, header, grip, wide, resize, left, right };
        root.addEventListener("pointerdown", (event) => event.stopPropagation());
        root.addEventListener("keydown", (event) => event.stopPropagation());
        wide.addEventListener("click", () => {
            const current = this.current(entry);
            if (current) this.setOption(entry, "width", current.options.width === "wide" ? "normal" : "wide");
        });
        grip.addEventListener("click", () => {
            if (entry.dragged) { entry.dragged = false; return; }
            this.controller.menus.open(entry.header, grip, this.controller.bindings.get(entry.header), "block");
        });
        grip.addEventListener("pointerdown", (event) => this.drag(entry, event));
        resize.addEventListener("pointerdown", (event) => this.resize(entry, event));
        resize.addEventListener("keydown", (event) => {
            if (!["ArrowUp", "ArrowDown", "Home"].includes(event.key)) return;
            event.preventDefault();
            this.setOption(entry, "height", event.key === "Home" ? 0 : Math.max(40, Math.min(2000, entry.bodyHeight + (event.key === "ArrowUp" ? -20 : 20))));
        });
        for (const [side, edge] of [["left", left], ["right", right]]) {
            edge.addEventListener("pointerdown", (event) => {
                event.preventDefault();
                const current = this.current(entry);
                if (current) this.focusEdge(current, side);
            });
            edge.addEventListener("keydown", (event) => this.edgeKey(entry, side, event));
            edge.addEventListener("paste", (event) => {
                const text = event.clipboardData?.getData("text/plain");
                if (!text) return;
                event.preventDefault();
                this.insertOutside(entry, side, text);
            });
        }
        this.layer.append(root);
        return entry;
    }

    sync() {
        if (this.destroyed) return;
        for (const dom of this.view.dom.querySelectorAll(".pw-note-code-body")) this.controller.bodies.get(dom)?.sync();
        const value = this.view.state.field(this.controller.field, false);
        const headers = this.controller.isLive(this.view.state) ? [...this.view.dom.querySelectorAll(".pw-note-code-header[data-from]")] : [];
        const visible = new Set();
        const rules = [];
        const origin = this.view.dom.getBoundingClientRect();
        const scroll = this.view.scrollDOM.getBoundingClientRect();
        const content = this.view.contentDOM.getBoundingClientRect();
        for (const header of headers) {
            const block = value?.blocks.find((candidate) => candidate.from === Number(header.dataset.from));
            if (!block) continue;
            const key = String(block.from);
            visible.add(key);
            let entry = this.entries.get(key);
            if (!entry) { entry = this.create(header, block); this.entries.set(key, entry); }
            entry.header = header;
            const folded = value.folded.has(block.from);
            const rect = header.getBoundingClientRect();
            const body = this.view.dom.querySelector(`.pw-note-code-body[data-pw-block="${key}"]`);
            const bottom = folded ? rect.bottom : body?.getBoundingClientRect().bottom ?? rect.bottom;
            entry.bodyHeight = Math.max(0, bottom - rect.bottom);
            const requested = entry.previewHeight ?? block.options.height;
            const selector = `[data-pw-editor="${this.id}"] :is(.cm-line, .pw-note-code-body)[data-pw-block="${key}"]`;
            if (body) rules.push(`${selector}.pw-note-code-body { --pw-code-height: ${requested ? `${Math.max(40, requested)}px` : "auto"} !important; }`);
            if (block.options.width === "wide") {
                const expansion = Math.max(0, Math.min(content.left - scroll.left - 40, scroll.right - content.right - 40));
                const offset = block.options.offset * 24;
                rules.push(`${selector} { width: ${content.width - offset + expansion * 2}px !important; margin-left: ${offset - expansion}px !important; max-width: none !important; }`);
            }
            Object.assign(entry.root.style, { left: `${rect.left - origin.left}px`, top: `${rect.top - origin.top}px`, width: `${rect.width}px`, height: `${bottom - rect.top}px` });
            entry.root.dataset.hover = String(this.hovered === key);
            header.dataset.hover = String(this.hovered === key);
            const focused = header.contains(this.doc.activeElement) || entry.root.contains(this.doc.activeElement)
                || Boolean(body?.contains(this.doc.activeElement))
                || this.view.contentDOM.contains(this.doc.activeElement) && this.view.state.selection.ranges.some((range) => range.head >= block.from && range.head <= block.to);
            entry.everFocused ||= focused;
            entry.root.dataset.resizeVisible = String(!entry.everFocused || focused);
            entry.root.dataset.focused = String(focused);
            entry.root.dataset.folded = String(folded);
            entry.root.hidden = this.view.state.readOnly;
            entry.wide.setAttribute("aria-pressed", String(block.options.width === "wide"));
            entry.resize.setAttribute("aria-valuenow", String(Math.round(entry.bodyHeight)));
        }
        for (const [key, entry] of this.entries) {
            if (visible.has(key)) continue;
            if (entry.root.contains(this.controller.menus.trigger)) this.controller.menus.close(false);
            entry.root.remove();
            this.entries.delete(key);
        }
        this.paragraphs.sync();
        const css = rules.join("\n");
        if (this.style.textContent !== css) {
            this.style.textContent = css;
            this.view.requestMeasure();
            this.schedule();
        }
    }

    setOption(entry, key, value) {
        const block = this.current(entry);
        if (!block || this.view.state.readOnly) return;
        this.view.dispatch({ changes: { from: block.from, to: block.openTo, insert: updateOpening(block, key, value) }, userEvent: "input.code-setting" });
    }

    focusEdge(block, side) {
        this.sync();
        const entry = this.entries.get(String(block.from));
        if (!entry) return false;
        entry[side].focus({ preventScroll: true });
        this.schedule();
        return true;
    }

    edgeKey(entry, side, event) {
        if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
        const block = this.current(entry);
        if (!block) return;
        if ((side === "left" && event.key === "Delete") || (side === "right" && event.key === "Backspace")) {
            event.preventDefault();
            if (!this.view.state.readOnly) this.controller.bindings.get(entry.header)?.remove();
            return;
        }
        if (side === "left" && event.key === "Backspace") {
            event.preventDefault();
            this.controller.removeBlankBeforeCode(this.view, block, true);
            return;
        }
        const inward = side === "left" ? "ArrowRight" : "ArrowLeft";
        if (event.key === inward) {
            event.preventDefault();
            this.view.dispatch({ selection: { anchor: side === "left" ? block.contentFrom : block.contentTo }, scrollIntoView: true });
            this.view.focus();
            return;
        }
        if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
            event.preventDefault();
            const before = event.key === "ArrowUp" || event.key === "ArrowLeft";
            const anchor = before ? block.from - 1 : block.to + 1;
            if (anchor >= 0 && anchor <= this.view.state.doc.length) {
                this.view.dispatch({ selection: { anchor }, scrollIntoView: true });
                this.view.focus();
            } else this.insertOutside(entry, before ? "left" : "right", "");
            return;
        }
        if (event.key === "Enter" || event.key.length === 1) {
            event.preventDefault();
            this.insertOutside(entry, side, event.key === "Enter" ? "" : event.key, event.key === "Enter" ? 1 : 2);
        }
        if (["Backspace", "Delete"].includes(event.key)) event.preventDefault();
    }

    insertOutside(entry, side, text, lineBreaks = 2) {
        const block = this.current(entry);
        if (!block || this.view.state.readOnly) return;
        const before = side === "left";
        const from = before ? block.from : block.to;
        const separator = "\n".repeat(lineBreaks);
        const insert = before ? `${text}${separator}` : `${separator}${text}`;
        this.view.dispatch({ changes: { from, insert }, selection: { anchor: from + (before ? text.length : insert.length) }, scrollIntoView: true, userEvent: "input" });
        this.view.focus();
    }

    track(event, move, finish) {
        this.cancelGesture?.();
        const abort = new this.win.AbortController();
        const initialDoc = this.view.state.doc;
        const options = { signal: abort.signal, capture: true };
        const end = (commit) => {
            abort.abort();
            this.cancelGesture = undefined;
            finish(commit && this.view.state.doc === initialDoc);
            this.schedule();
        };
        this.cancelGesture = () => end(false);
        this.doc.addEventListener("pointermove", (next) => {
            if (next.pointerId !== event.pointerId) return;
            next.preventDefault();
            move(next);
        }, options);
        this.doc.addEventListener("pointerup", (next) => { if (next.pointerId === event.pointerId) end(true); }, options);
        this.doc.addEventListener("pointercancel", () => end(false), options);
        this.doc.addEventListener("keydown", (key) => { if (key.key === "Escape") { key.preventDefault(); end(false); } }, options);
        this.win.addEventListener("blur", () => end(false), options);
    }

    resize(entry, event) {
        if (event.button !== 0 || this.view.state.readOnly) return;
        event.preventDefault();
        entry.resize.focus({ preventScroll: true });
        const start = entry.bodyHeight;
        entry.root.dataset.resizing = "true";
        this.track(event, (next) => {
            entry.previewHeight = Math.max(40, Math.min(2000, start + next.clientY - event.clientY));
            this.schedule();
        }, (commit) => {
            const height = entry.previewHeight;
            entry.previewHeight = undefined;
            entry.root.dataset.resizing = "false";
            if (commit && height !== undefined) this.setOption(entry, "height", Math.round(height));
        });
    }

    drag(entry, event) {
        if (event.button !== 0 || this.view.state.readOnly) return;
        event.preventDefault();
        entry.dragged = false;
        const block = this.current(entry);
        if (!block) return;
        const blocks = documentBlocks(this.view.state.doc);
        const marker = this.doc.createElement("div");
        marker.className = "pw-code-drop-marker";
        marker.hidden = true;
        this.layer.append(marker);
        let destination;
        this.track(event, (next) => {
            if (Math.hypot(next.clientX - event.clientX, next.clientY - event.clientY) < 5 && !entry.dragged) return;
            entry.dragged = true;
            entry.root.dataset.dragging = "true";
            const scroll = this.view.scrollDOM.getBoundingClientRect();
            if (next.clientY < scroll.top + 36) this.view.scrollDOM.scrollTop -= 18;
            if (next.clientY > scroll.bottom - 36) this.view.scrollDOM.scrollTop += 18;
            const position = this.view.posAtCoords({ x: Math.max(scroll.left + 45, Math.min(scroll.right - 45, next.clientX)), y: next.clientY });
            if (position === null) { marker.hidden = true; destination = undefined; return; }
            const target = blocks.find((candidate) => position <= candidate.to) ?? blocks[blocks.length - 1];
            if (!target || target.from === block.from) { marker.hidden = true; destination = undefined; return; }
            const top = this.view.coordsAtPos(target.from);
            const bottom = this.view.coordsAtPos(target.to);
            if (!top || !bottom) return;
            const before = next.clientY < (top.top + bottom.bottom) / 2;
            destination = before ? target.from : Math.min(this.view.state.doc.length, target.to + 1);
            const origin = this.view.dom.getBoundingClientRect();
            const content = this.view.contentDOM.getBoundingClientRect();
            Object.assign(marker.style, { left: `${content.left - origin.left}px`, top: `${(before ? top.top : bottom.bottom) - origin.top}px`, width: `${content.width}px` });
            marker.hidden = false;
        }, (commit) => {
            marker.remove();
            entry.root.dataset.dragging = "false";
            if (commit && entry.dragged && destination !== undefined) moveCodeBlock(this.view, block, destination);
        });
    }

    destroy() {
        this.destroyed = true;
        this.cancelGesture?.();
        this.win.cancelAnimationFrame(this.frame);
        this.listeners.abort();
        this.observer.disconnect();
        this.controller.menus.close(false);
        this.paragraphs.destroy();
        this.layer.remove();
        this.style.remove();
        delete this.view.dom.dataset.pwEditor;
        this.view.dom.classList.remove("pw-code-margin-hover");
        this.entries.clear();
    }
}

export { NoteCodeControls };
