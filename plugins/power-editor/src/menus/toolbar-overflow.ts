import { App, setIcon } from "obsidian";
import { EditorMenu } from "./editor-menu";

export interface ToolbarAction {
    label: string;
    icon: string;
    run: () => void;
}

/** One command registry serves both the toolbar and its responsive overflow. */
export class ToolbarOverflow {
    private readonly more: HTMLButtonElement;
    private readonly items: HTMLElement[];
    private readonly resize: ResizeObserver;
    private menu: EditorMenu | null = null;
    private frame = 0;
    private width = 0;
    private disposed = false;

    constructor(private app: App, private el: HTMLElement, private actions: Map<HTMLElement, ToolbarAction>) {
        this.items = Array.from(el.children) as HTMLElement[];
        this.more = el.createEl("button", {
            cls: "ped-btn pw-toolbar-more",
            attr: { "aria-label": "More formatting options", "aria-haspopup": "menu", "aria-expanded": "false" },
        });
        setIcon(this.more, "ellipsis-vertical");
        this.more.addEventListener("pointerdown", e => e.preventDefault());
        this.more.addEventListener("click", () => this.open());
        this.resize = new ResizeObserver(() => this.schedule());
        this.resize.observe(el);
        // Heading labels and user font sizes can change without resizing the pane.
        for (const item of this.items) this.resize.observe(item);
        this.layout();
    }

    private schedule() {
        if (this.disposed || this.frame) return;
        this.frame = this.el.ownerDocument.defaultView!.requestAnimationFrame(() => {
            this.frame = 0;
            this.layout();
        });
    }

    private layout() {
        if (this.disposed) return;
        if (!this.el.isConnected) { this.dispose(); return; }
        if (!this.el.clientWidth || !this.el.clientHeight) { this.menu?.hide(); return; }
        if (this.width !== this.el.clientWidth) this.menu?.hide();
        this.width = this.el.clientWidth;
        const previous = this.items.filter(item => item.hasAttribute("data-overflow"));
        for (const item of this.items) item.removeAttribute("data-overflow");
        this.more.hidden = false;
        const win = this.el.ownerDocument.defaultView!;
        const style = win.getComputedStyle(this.el);
        const available = this.el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
        const gap = parseFloat(style.columnGap) || 0;
        const widths = this.items.map(item => {
            const s = win.getComputedStyle(item);
            return item.getBoundingClientRect().width + parseFloat(s.marginLeft) + parseFloat(s.marginRight);
        });
        const full = widths.reduce((sum, width) => sum + width, 0) + gap * Math.max(0, widths.length - 1);
        let count = this.items.length;
        if (full > available) {
            const budget = available - this.more.getBoundingClientRect().width - gap;
            let used = 0;
            count = 0;
            for (const width of widths) {
                const next = used + (count ? gap : 0) + width;
                if (next > budget) break;
                used = next;
                count++;
            }
            // Never leave a group separator next to the overflow trigger.
            while (count && this.items[count - 1].classList.contains("ped-sep")) count--;
        }
        this.items.forEach((item, index) => item.toggleAttribute("data-overflow", index >= count));
        this.more.hidden = count === this.items.length;
        const next = this.items.slice(count);
        if (previous.length !== next.length || previous.some((item, i) => item !== next[i])) this.menu?.hide();
    }

    private open() {
        if (this.menu) { this.menu.hide(); return; }
        const source = this.el.ownerDocument.activeElement as HTMLElement | null;
        const menu = new EditorMenu(this.app);
        let separator = false;
        let hasItems = false;
        for (const item of this.items) {
            if (!item.hasAttribute("data-overflow")) continue;
            const action = this.actions.get(item);
            if (!action) { separator = hasItems; continue; }
            if (separator) menu.addSeparator();
            separator = false;
            hasItems = true;
            menu.addItem(entry => {
                entry.setTitle(action.label).setIcon(action.icon)
                    .setDisabled(item.classList.contains("is-disabled"))
                    .onClick(() => {
                        menu.hide();
                        if (source?.isConnected) source.focus({ preventScroll: true });
                        action.run();
                    });
                if (item.classList.contains("is-active")) entry.setChecked(true);
            });
        }
        if (!hasItems) return;
        this.menu = menu;
        this.more.setAttribute("aria-expanded", "true");
        menu.onHide(() => {
            if (this.menu === menu) this.menu = null;
            this.more.setAttribute("aria-expanded", "false");
        });
        const r = this.more.getBoundingClientRect();
        menu.showAtPosition({ x: r.left, y: r.bottom + 4 });
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.resize.disconnect();
        this.el.ownerDocument.defaultView!.cancelAnimationFrame(this.frame);
        this.menu?.hide();
        this.more.remove();
    }
}
