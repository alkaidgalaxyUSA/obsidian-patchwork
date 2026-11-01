import { ContentMenu as Menu } from "../utils/portals";
import { activeMarkdownView, markdownViews } from "../utils/markdown-views";
import { App} from "obsidian";

const openMenus = new Set<EditorMenu>();
export function closeEditorMenus() {
    for (const menu of Array.from(openMenus)) menu.hide();
}

/** Native keyboard/menu behavior with the same visual surface as block menus. */
export class EditorMenu extends Menu {
    constructor(private app: App) { super(); }

    showAtPosition(position: Parameters<Menu["showAtPosition"]>[0]): this {
        const doc: Document = (position as Parameters<Menu["showAtPosition"]>[0] & { doc?: Document }).doc ?? this.app.workspace.containerEl.ownerDocument;
        for (const bubble of Array.from(doc.querySelectorAll<HTMLElement>(".ped-bubble"))) bubble.hide();
        const dom = (this as unknown as { dom: HTMLElement }).dom;
        dom.addClass("pw-editor-menu");
        super.showAtPosition(position);
        openMenus.add(this);
        const active = activeMarkdownView(this.app);
        const view = (active?.containerEl.ownerDocument === doc ? active : markdownViews(this.app).find(item => item.containerEl.ownerDocument === doc && item.containerEl.getClientRects().length))?.containerEl;
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
