import { App, Menu, MarkdownView } from "obsidian";

const openMenus = new Set<EditorMenu>();
export function closeEditorMenus() {
    for (const menu of Array.from(openMenus)) menu.hide();
}

/** Native keyboard/menu behavior with the same visual surface as block menus. */
export class EditorMenu extends Menu {
    constructor(private app: App) { super(); }

    showAtPosition(position: Parameters<Menu["showAtPosition"]>[0]): this {
        const doc = this.app.workspace.containerEl.ownerDocument;
        for (const bubble of Array.from(doc.querySelectorAll<HTMLElement>(".ped-bubble"))) bubble.hide();
        const dom = (this as unknown as { dom: HTMLElement }).dom;
        dom.addClass("pw-editor-menu");
        super.showAtPosition(position);
        openMenus.add(this);
        const view = this.app.workspace.getActiveViewOfType(MarkdownView)?.containerEl;
        const bounds = view?.getBoundingClientRect();
        if (bounds && bounds.width > 0) {
            const r = dom.getBoundingClientRect();
            dom.style.maxWidth = Math.max(0, bounds.width - 16) + "px";
            dom.style.left = Math.max(bounds.left + 8, Math.min(r.left, bounds.right - r.width - 8)) + "px";
        }
        return this;
    }

    hide() {
        openMenus.delete(this);
        super.hide();
        return this;
    }
}
