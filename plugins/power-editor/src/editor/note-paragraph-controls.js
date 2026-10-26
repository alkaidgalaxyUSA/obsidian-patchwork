import { documentBlocks } from "./utils/document-blocks.js";
import { NoteParagraphActions } from "./note-paragraph-actions.js";

class NoteParagraphControls {
    constructor(controls) {
        this.controls = controls;
        this.controller = controls.controller;
        this.view = controls.view;
        this.entries = new Map();
        this.actions = new NoteParagraphActions(this.controller);
    }

    current(entry) {
        if (this.doc !== this.view.state.doc) return;
        return this.blocks.find((block) => block.from === Number(entry.root.dataset.from));
    }

    hoverAt(event) {
        for (const [key, entry] of this.entries) {
            const rect = entry.root.getBoundingClientRect();
            const gutter = entry.root.dataset.type.startsWith("heading-") ? 84 : 32;
            if (event.clientY >= rect.top && event.clientY < rect.top + entry.hoverHeight
                && event.clientX >= rect.left - gutter && event.clientX <= rect.right) return key;
        }
    }

    expandQuote(block) {
        if (block.type !== "quote" || block.complex) return [block];
        const blocks = [block];
        const last = this.doc.lineAt(block.to).number;
        for (let number = this.doc.lineAt(block.from).number + 1; number <= last; number++) {
            const line = this.doc.line(number);
            blocks.push({ ...block, from: line.from, to: line.to, contentFrom: line.from });
        }
        return blocks;
    }

    alignHeading(entry, block, top) {
        if (!block.type.startsWith("heading-")) {
            delete entry.root.dataset.headingLabel;
            entry.root.style.removeProperty("--pw-heading-control-center");
            entry.root.style.removeProperty("--pw-heading-highlight-top");
            entry.root.style.removeProperty("--pw-heading-highlight-height");
            return;
        }
        entry.root.dataset.headingLabel = `H${block.type.slice(8)}`;
        const { node } = this.view.domAtPos(block.from);
        const element = node.nodeType === 1 ? node : node.parentElement;
        const line = element.closest(".cm-line");
        const fold = line?.querySelector(".cm-fold-indicator .collapse-indicator");
        const rect = fold?.getBoundingClientRect() ?? this.view.coordsAtPos(block.from);
        if (rect) entry.root.style.setProperty("--pw-heading-control-center", `${(rect.top + rect.bottom) / 2 - top}px`);
        if (!line) return;
        const bounds = line.getBoundingClientRect();
        const style = line.ownerDocument.defaultView.getComputedStyle(line);
        const paddingTop = parseFloat(style.paddingTop) || 0;
        const paddingBottom = parseFloat(style.paddingBottom) || 0;
        entry.root.style.setProperty("--pw-heading-highlight-top", `${bounds.top + paddingTop - 4 - top}px`);
        entry.root.style.setProperty("--pw-heading-highlight-height", `${Math.max(0, bounds.height - paddingTop - paddingBottom) + 8}px`);
    }

    sync() {
        if (this.doc !== this.view.state.doc) {
            for (const entry of this.entries.values()) this.controller.menus.closeForHeader(entry.root);
            this.doc = this.view.state.doc;
            this.blocks = documentBlocks(this.doc).filter((block) => block.type !== "code" && !/^\^[\w-]+\s*$/.test(this.doc.sliceString(block.from, block.to)))
                .flatMap((block) => this.expandQuote(block))
                .map((block) => ({ ...block, contentTo: block.to, options: { offset: 0 } }));
        }
        const visible = new Set();
        const origin = this.view.dom.getBoundingClientRect();
        const content = this.view.contentDOM.getBoundingClientRect();
        const live = this.controller.isLive(this.view.state) && !this.view.state.readOnly;
        for (const block of live ? this.blocks : []) {
            if (!this.view.visibleRanges.some((range) => block.to >= range.from && block.from <= range.to)) continue;
            const first = this.view.lineBlockAt(block.from);
            const last = this.view.lineBlockAt(block.to);
            const key = String(block.from);
            visible.add(key);
            let entry = this.entries.get(key);
            if (!entry) { entry = this.create(block); this.entries.set(key, entry); }
            entry.hoverHeight = block.type === "quote" && !block.complex ? first.height : last.top + last.height - first.top;
            entry.root.dataset.type = block.type;
            Object.assign(entry.root.style, {
                left: `${content.left - origin.left}px`, top: `${this.view.documentTop + first.top - origin.top}px`,
                width: `${content.width}px`, height: `${last.top + last.height - first.top}px`,
            });
            entry.root.style.setProperty("--pw-paragraph-first-line-height", `${first.height}px`);
            this.alignHeading(entry, block, this.view.documentTop + first.top);
            entry.root.dataset.hover = String(this.controls.hovered === key);
            entry.root.dataset.focused = String(entry.root.contains(entry.root.ownerDocument.activeElement));
        }
        for (const [key, entry] of this.entries) {
            if (visible.has(key)) continue;
            this.controller.menus.closeForHeader(entry.root);
            entry.root.remove();
            this.entries.delete(key);
        }
    }

    create(block) {
        const root = this.controls.doc.createElement("div");
        root.className = "pw-code-controls pw-paragraph-controls";
        root.dataset.from = String(block.from);
        const grip = this.controls.button(root, "pw-code-drag", "can drag and click");
        grip.setAttribute("aria-haspopup", "dialog");
        grip.setAttribute("aria-expanded", "false");
        for (let dot = 0; dot < 8; dot++) grip.append(this.controls.doc.createElement("i"));
        const entry = { root, header: root, grip, paragraph: true };
        this.controller.bindings.set(root, {
            getBlock: () => this.current(entry), canIndent: false,
            perform: (action, value) => this.actions.run(this.view, root, action, value),
        });
        root.addEventListener("pointerdown", (event) => event.stopPropagation());
        root.addEventListener("keydown", (event) => event.stopPropagation());
        grip.addEventListener("pointerdown", (event) => this.controls.drag(entry, event));
        grip.addEventListener("click", () => {
            if (entry.dragged) { entry.dragged = false; return; }
            this.controller.menus.open(root, grip, this.controller.bindings.get(root), "block");
        });
        this.controls.layer.append(root);
        return entry;
    }

    destroy() {
        for (const entry of this.entries.values()) {
            this.controller.menus.closeForHeader(entry.root);
            entry.root.remove();
        }
        this.entries.clear();
    }
}

export { NoteParagraphControls };
