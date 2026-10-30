import { Menu } from "obsidian";
import { setIcon } from "../../../../utils/icons";

/** Shared tab strip for the two bottom tool windows. */
export class ToolTabs {
    constructor(host, title, create, hide) {
        this.host = host;
        this.tabs = [];
        this.header = host.createDiv({ cls: "pw-tool-header" });
        this.header.createSpan({ cls: "pw-tool-title", text: title });
        this.strip = this.header.createDiv({ cls: "pw-tool-tabs", attr: { role: "tablist" } });
        this.add = this.button("New tab", "plus", create);
        this.button("Select tab", "chevron-down", () => {
            const menu = new Menu();
            for (const tab of this.tabs) menu.addItem(item => item.setTitle(tab.label).setChecked(tab === this.active).onClick(() => this.select(tab)));
            const bounds = this.header.getBoundingClientRect();
            menu.showAtPosition({ x: bounds.left + 72, y: bounds.bottom });
        });
        this.actions = this.header.createDiv({ cls: "pw-tool-header-actions" });
        this.button("Hide tool window", "minus", hide, this.actions);
        this.body = host.createDiv({ cls: "pw-tool-body" });
    }

    button(label, icon, action, parent = this.header) {
        const button = parent.createEl("button", { cls: "clickable-icon", attr: { type: "button", "aria-label": label, "data-tooltip-position": "top" } });
        setIcon(button, icon);
        button.addEventListener("click", action);
        return button;
    }

    append(label, pane) {
        const tab = { label, pane };
        tab.el = this.strip.createDiv({ cls: "pw-tool-tab", attr: { role: "tab", tabindex: "0" } });
        tab.title = tab.el.createSpan({ text: label });
        const close = tab.el.createEl("button", { cls: "clickable-icon", attr: { type: "button", "aria-label": "Close tab" } });
        setIcon(close, "x");
        close.addEventListener("click", event => { event.stopPropagation(); this.remove(tab); });
        tab.el.addEventListener("click", () => this.select(tab));
        tab.el.addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); this.select(tab); } });
        this.tabs.push(tab);
        this.select(tab);
        return tab;
    }

    select(tab) {
        this.active = tab;
        for (const item of this.tabs) {
            item.el.classList.toggle("is-active", item === tab);
            item.el.setAttribute("aria-selected", String(item === tab));
            item.pane.el.hidden = item !== tab;
        }
        tab.pane.focus?.();
    }

    remove(tab) {
        const index = this.tabs.indexOf(tab);
        if (index < 0) return;
        tab.pane.dispose();
        tab.el.remove();
        this.tabs.splice(index, 1);
        if (this.active === tab) {
            this.active = undefined;
            if (this.tabs.length) this.select(this.tabs[Math.min(index, this.tabs.length - 1)]);
        }
    }

    dispose() { for (const tab of [...this.tabs]) this.remove(tab); this.header.remove(); this.body.remove(); }
}
