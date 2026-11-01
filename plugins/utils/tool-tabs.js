import { Menu } from "obsidian";
import { createModuleIcons } from "./icons";
import { scopeModule } from "./module-scope";

/** Shared tab strip for the two bottom tool windows. */
export class ToolTabs {
    constructor(host, owner, title, create, hide) {
        this.host = host;
        this.owner = owner;
        this.setIcon = createModuleIcons(owner).setIcon;
        this.menus = new Set();
        this.tabs = [];
        this.header = host.createDiv({ cls: "pw-tool-header" });
        this.headerScope = scopeModule(this.header, owner, { surface: "tool-tabs" });
        this.header.createSpan({ cls: "pw-tool-title", text: title });
        this.strip = this.header.createDiv({ cls: "pw-tool-tabs", attr: { role: "tablist" } });
        this.add = this.button("New tab", "plus", create);
        this.button("Select tab", "chevron-down", () => {
            const menu = new Menu();
            const scope = scopeModule(menu.dom, owner, { surface: "tab-menu" });
            scope.refreshTokens(this.header);
            this.menus.add(menu);
            menu.onHide(() => { scope.dispose(); this.menus.delete(menu); });
            for (const tab of this.tabs) menu.addItem(item => item.setTitle(tab.label).setChecked(tab === this.active).onClick(() => this.select(tab)));
            const bounds = this.header.getBoundingClientRect();
            menu.showAtPosition({ x: bounds.left + 72, y: bounds.bottom });
        });
        this.actions = this.header.createDiv({ cls: "pw-tool-header-actions" });
        this.button("Hide tool window", "minus", hide, this.actions);
        this.body = host.createDiv({ cls: "pw-tool-body" });
        this.bodyScope = scopeModule(this.body, owner, { surface: "tool-body" });
    }

    button(label, icon, action, parent = this.header) {
        const button = parent.createEl("button", { cls: "clickable-icon", attr: { type: "button", "aria-label": label, "data-tooltip-position": "top" } });
        this.setIcon(button, icon);
        button.addEventListener("click", event => { if (!this.disposed) action(event); });
        return button;
    }

    append(label, pane) {
        if (this.disposed) { pane.dispose(); throw new Error("The tool tab host was disposed."); }
        const tab = { label, pane };
        tab.el = this.strip.createDiv({ cls: "pw-tool-tab", attr: { role: "tab", tabindex: "0" } });
        tab.title = tab.el.createSpan({ text: label });
        const close = tab.el.createEl("button", { cls: "clickable-icon", attr: { type: "button", "aria-label": "Close tab" } });
        this.setIcon(close, "x");
        close.addEventListener("click", event => { event.stopPropagation(); this.remove(tab); });
        tab.el.addEventListener("click", () => this.select(tab));
        tab.el.addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); this.select(tab); } });
        this.tabs.push(tab);
        this.select(tab);
        return tab;
    }

    select(tab) {
        if (this.disposed || !this.tabs.includes(tab)) return;
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

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        for (const menu of this.menus) menu.hide();
        this.menus.clear();
        for (const tab of [...this.tabs]) this.remove(tab);
        this.headerScope.dispose(); this.bodyScope.dispose();
        this.header.remove(); this.body.remove();
    }
}
