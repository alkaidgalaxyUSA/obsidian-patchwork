const { readCodeBlock } = require("./utils/code-block");

const WRAPPER_SELECTOR = ".claudian-container .claudian-code-wrapper";
const ENHANCED_CLASS = "claudian-note-actions-enhanced";
const TOOLBAR_CLASS = "claudian-note-actions-toolbar";
const COPY_SELECTOR = ":scope > .claudian-code-lang-label, :scope > .copy-code-button, :scope > pre > .copy-code-button";

class CodeActions {
    constructor(inserter, { Menu, setIcon }) {
        this.Menu = Menu;
        this.setIcon = setIcon;
        this.inserter = inserter;
        this.documents = new Map();
        this.disposed = false;
    }

    attach(doc) {
        if (this.disposed || this.documents.has(doc) || !doc.body) return;
        const win = doc.defaultView;
        if (!win) return;

        const observer = new win.MutationObserver((records) => {
            for (const record of records) {
                for (const node of record.addedNodes) {
                    if (node.nodeType === 1) this.scan(node);
                }
            }
        });
        observer.observe(doc.body, { childList: true, subtree: true });

        const click = (event) => this.handleClick(event);
        const pointerdown = (event) => {
            if (event.target.closest?.(`.${TOOLBAR_CLASS}`)) event.stopPropagation();
        };
        const pointerover = (event) => {
            const toolbar = event.target.closest?.(`.${TOOLBAR_CLASS}`);
            if (toolbar) this.updateTitle(toolbar);
        };
        const focusin = (event) => {
            const toolbar = event.target.closest?.(`.${TOOLBAR_CLASS}`);
            if (toolbar) this.updateTitle(toolbar);
        };
        const keydown = (event) => this.handleKeydown(event);
        const unload = () => this.detach(doc);
        doc.addEventListener("click", click);
        doc.addEventListener("pointerdown", pointerdown);
        doc.addEventListener("pointerover", pointerover);
        doc.addEventListener("focusin", focusin);
        doc.addEventListener("keydown", keydown, true);
        win.addEventListener("unload", unload, { once: true });

        this.documents.set(doc, () => {
            observer.disconnect();
            doc.removeEventListener("click", click);
            doc.removeEventListener("pointerdown", pointerdown);
            doc.removeEventListener("pointerover", pointerover);
            doc.removeEventListener("focusin", focusin);
            doc.removeEventListener("keydown", keydown, true);
            win.removeEventListener("unload", unload);
            doc.querySelectorAll(`.${ENHANCED_CLASS}`).forEach((wrapper) => {
                wrapper.querySelector(`:scope > .${TOOLBAR_CLASS}`)?.remove();
                wrapper.classList.remove(ENHANCED_CLASS);
                if (wrapper.dataset.claudianNoteActionsTabindex === "added") {
                    wrapper.removeAttribute("tabindex");
                    delete wrapper.dataset.claudianNoteActionsTabindex;
                }
            });
        });
        this.scan(doc.body);
    }

    scan(root) {
        const ancestor = root.closest?.(WRAPPER_SELECTOR);
        if (ancestor) this.enhance(ancestor);
        root.querySelectorAll(WRAPPER_SELECTOR).forEach((wrapper) => this.enhance(wrapper));
    }

    enhance(wrapper) {
        const existingToolbar = wrapper.querySelector(`:scope > .${TOOLBAR_CLASS}`);
        if (existingToolbar) {
            existingToolbar.querySelector('[data-note-action="copy"]').disabled = !wrapper.querySelector(COPY_SELECTOR);
            return;
        }
        if (!readCodeBlock(wrapper)) return;
        const doc = wrapper.ownerDocument;
        const toolbar = doc.createElement("div");
        toolbar.className = TOOLBAR_CLASS;
        toolbar.setAttribute("role", "group");
        toolbar.setAttribute("aria-label", "Code block actions");

        const copy = doc.createElement("button");
        copy.type = "button";
        copy.dataset.noteAction = "copy";
        copy.setAttribute("aria-label", "Copy code");
        copy.disabled = !wrapper.querySelector(COPY_SELECTOR);
        const copyIcon = doc.createElement("span");
        copyIcon.setAttribute("aria-hidden", "true");
        this.setIcon(copyIcon, "copy");
        copy.append(copyIcon);

        const insert = doc.createElement("button");
        insert.type = "button";
        insert.dataset.noteAction = "insert";
        const icon = doc.createElement("span");
        icon.setAttribute("aria-hidden", "true");
        this.setIcon(icon, "text-cursor-input");
        insert.append(icon);

        const more = doc.createElement("button");
        more.type = "button";
        more.dataset.noteAction = "more";
        more.setAttribute("aria-label", "More insert options");
        more.setAttribute("aria-haspopup", "menu");
        this.setIcon(more, "ellipsis");
        toolbar.append(copy, insert, more);
        this.updateTitle(toolbar);
        wrapper.classList.add(ENHANCED_CLASS);
        if (!wrapper.hasAttribute("tabindex")) {
            wrapper.tabIndex = 0;
            wrapper.dataset.claudianNoteActionsTabindex = "added";
        }
        wrapper.prepend(toolbar);
    }

    updateTitle(toolbar) {
        const insert = toolbar.querySelector('[data-note-action="insert"]');
        if (!insert) return;
        // Obsidian uses aria-label for its tooltip; title would show a second one.
        insert.setAttribute("aria-label", `Insert into note\n${this.inserter.describeTarget()}\nInsert Markdown as raw text and other languages as fenced code. Press Ctrl+Enter while this code block is focused.`);
    }

    handleClick(event) {
        const button = event.target.closest?.(`.${TOOLBAR_CLASS} button[data-note-action]`);
        const wrapper = button?.closest(WRAPPER_SELECTOR);
        if (!wrapper) return;
        event.preventDefault();
        event.stopPropagation();
        const block = readCodeBlock(wrapper);
        if (!block) return;
        if (button.dataset.noteAction === "copy") {
            // Reuse Claudian's native clipboard handler and accessible copy status.
            wrapper.querySelector(COPY_SELECTOR)?.click();
            return;
        }
        if (button.dataset.noteAction === "insert") {
            this.inserter.insert(block);
            return;
        }

        this.menu?.hide();
        const menu = new this.Menu();
        this.menu = menu;
        menu.addItem((item) => item.setTitle("Insert raw text (without code fences)").setIcon("text")
            .onClick(() => this.inserter.insert(block, "raw")));
        menu.addItem((item) => item.setTitle("Insert code block (preserve language)").setIcon("code-2")
            .onClick(() => this.inserter.insert(block, "fenced")));
        const rect = button.getBoundingClientRect();
        menu.showAtPosition({ x: rect.left, y: rect.bottom, doc: button.ownerDocument });
    }

    handleKeydown(event) {
        if (event.key !== "Enter" || !event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || event.repeat || event.isComposing) return;
        const target = event.target;
        if (target.closest?.('input, textarea, select, [contenteditable="true"], .cm-editor, .claudian-composer-editor')) return;
        const wrapper = target.closest?.(WRAPPER_SELECTOR);
        if (!wrapper?.classList.contains(ENHANCED_CLASS)) return;
        const block = readCodeBlock(wrapper);
        if (!block) return;
        event.preventDefault();
        event.stopPropagation();
        this.inserter.insert(block);
    }

    detach(doc) {
        this.documents.get(doc)?.();
        this.documents.delete(doc);
    }

    dispose() {
        this.disposed = true;
        this.menu?.hide();
        for (const doc of Array.from(this.documents.keys())) this.detach(doc);
    }
}

module.exports = { CodeActions };
