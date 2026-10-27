import { iconName, setIcon } from "../../utils/icons";
import { Menu} from "obsidian";
import { NoteInserter } from "./note-inserter";
import { readCodeBlock } from "./utils/code-block";
import { eventElement, getWindow } from "./utils/dom";

const WRAPPER_SELECTOR = ".claudian-container .claudian-code-wrapper";
const ENHANCED_CLASS = "claudian-extension-enhanced";
const TOOLBAR_CLASS = "claudian-extension-toolbar";
const COPY_SELECTOR = ":scope > .claudian-code-lang-label, :scope > .copy-code-button, :scope > pre > .copy-code-button";

export class CodeActions {
    private documents = new Map<Document, () => void>();
    private menu?: Menu;
    disposed = false;

    constructor(private readonly inserter: NoteInserter) {}

    attach(doc: Document) {
        if (this.disposed || this.documents.has(doc) || !doc.body) return;
        const win = getWindow(doc);
        if (!win) return;

        const observer = new win.MutationObserver((records) => {
            for (const record of records) {
                for (const node of record.addedNodes) {
                    if (node.nodeType === 1) this.scan(node as HTMLElement);
                }
            }
        });
        observer.observe(doc.body, { childList: true, subtree: true });

        const click = (event: MouseEvent) => this.handleClick(event);
        const pointerdown = (event: PointerEvent) => {
            if (eventElement(event)?.closest<HTMLElement>(`.${TOOLBAR_CLASS}`)) event.stopPropagation();
        };
        const pointerover = (event: PointerEvent) => {
            const toolbar = eventElement(event)?.closest<HTMLElement>(`.${TOOLBAR_CLASS}`);
            if (toolbar) this.updateTitle(toolbar);
        };
        const focusin = (event: FocusEvent) => {
            const toolbar = eventElement(event)?.closest<HTMLElement>(`.${TOOLBAR_CLASS}`);
            if (toolbar) this.updateTitle(toolbar);
        };
        const keydown = (event: KeyboardEvent) => this.handleKeydown(event);
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
            doc.querySelectorAll<HTMLElement>(`.${ENHANCED_CLASS}`).forEach((wrapper) => {
                wrapper.querySelector<HTMLElement>(`:scope > .${TOOLBAR_CLASS}`)?.remove();
                wrapper.classList.remove(ENHANCED_CLASS);
                if (wrapper.dataset.claudianExtensionTabindex === "added") {
                    wrapper.removeAttribute("tabindex");
                    delete wrapper.dataset.claudianExtensionTabindex;
                }
            });
        });
        this.scan(doc.body);
    }

    scan(root: HTMLElement) {
        const ancestor = root.closest<HTMLElement>(WRAPPER_SELECTOR);
        if (ancestor) this.enhance(ancestor);
        root.querySelectorAll<HTMLElement>(WRAPPER_SELECTOR).forEach((wrapper) => this.enhance(wrapper));
    }

    enhance(wrapper: HTMLElement) {
        const existingToolbar = wrapper.querySelector<HTMLElement>(`:scope > .${TOOLBAR_CLASS}`);
        if (existingToolbar) {
            existingToolbar.querySelector<HTMLButtonElement>('[data-note-action="copy"]')!.disabled = !wrapper.querySelector<HTMLElement>(COPY_SELECTOR);
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
        copy.disabled = !wrapper.querySelector<HTMLElement>(COPY_SELECTOR);
        const copyIcon = doc.createElement("span");
        copyIcon.setAttribute("aria-hidden", "true");
        setIcon(copyIcon, "copy");
        copy.append(copyIcon);

        const insert = doc.createElement("button");
        insert.type = "button";
        insert.dataset.noteAction = "insert";
        const icon = doc.createElement("span");
        icon.setAttribute("aria-hidden", "true");
        setIcon(icon, "text-cursor-input");
        insert.append(icon);

        const more = doc.createElement("button");
        more.type = "button";
        more.dataset.noteAction = "more";
        more.setAttribute("aria-label", "More insert options");
        more.setAttribute("aria-haspopup", "menu");
        setIcon(more, "ellipsis");
        toolbar.append(copy, insert, more);
        this.updateTitle(toolbar);
        wrapper.classList.add(ENHANCED_CLASS);
        if (!wrapper.hasAttribute("tabindex")) {
            wrapper.tabIndex = 0;
            wrapper.dataset.claudianExtensionTabindex = "added";
        }
        wrapper.prepend(toolbar);
    }

    updateTitle(toolbar: HTMLElement) {
        const insert = toolbar.querySelector<HTMLElement>('[data-note-action="insert"]');
        if (!insert) return;
        // Obsidian uses aria-label for its tooltip; title would show a second one.
        insert.setAttribute("aria-label", `Insert into note\n${this.inserter.describeTarget()}\nInsert Markdown as raw text and other languages as fenced code. Press Ctrl+Enter while this code block is focused.`);
    }

    handleClick(event: MouseEvent) {
        const button = eventElement(event)?.closest<HTMLElement>(`.${TOOLBAR_CLASS} button[data-note-action]`);
        const wrapper = button?.closest<HTMLElement>(WRAPPER_SELECTOR);
        if (!button || !wrapper) return;
        event.preventDefault();
        event.stopPropagation();
        const block = readCodeBlock(wrapper);
        if (!block) return;
        if (button.dataset.noteAction === "copy") {
            // Reuse Claudian's native clipboard handler and accessible copy status.
            wrapper.querySelector<HTMLElement>(COPY_SELECTOR)?.click();
            return;
        }
        if (button.dataset.noteAction === "insert") {
            this.inserter.insert(block);
            return;
        }

        this.menu?.hide();
        const menu = new Menu();
        this.menu = menu;
        menu.addItem((item) => item.setTitle("Insert raw text (without code fences)").setIcon(iconName("text"))
            .onClick(() => this.inserter.insert(block, "raw")));
        menu.addItem((item) => item.setTitle("Insert code block (preserve language)").setIcon(iconName("code-2"))
            .onClick(() => this.inserter.insert(block, "fenced")));
        const rect = button.getBoundingClientRect();
        const position = { x: rect.left, y: rect.bottom, doc: button.ownerDocument };
        menu.showAtPosition(position);
    }

    handleKeydown(event: KeyboardEvent) {
        if (event.key !== "Enter" || !event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || event.repeat || event.isComposing) return;
        const target = eventElement(event);
        if (!target) return;
        if (target.closest<HTMLElement>('input, textarea, select, [contenteditable="true"], .cm-editor, .claudian-composer-editor')) return;
        const wrapper = target.closest<HTMLElement>(WRAPPER_SELECTOR);
        if (!wrapper?.classList.contains(ENHANCED_CLASS)) return;
        const block = readCodeBlock(wrapper);
        if (!block) return;
        event.preventDefault();
        event.stopPropagation();
        this.inserter.insert(block);
    }

    detach(doc: Document) {
        this.documents.get(doc)?.();
        this.documents.delete(doc);
    }

    dispose() {
        this.disposed = true;
        this.menu?.hide();
        for (const doc of Array.from(this.documents.keys())) this.detach(doc);
    }
}
