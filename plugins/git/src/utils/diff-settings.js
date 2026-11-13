import { Menu } from "obsidian";
import { scopeGitMenu } from "./portals";

export function diffSettings(view, event) {
    const menu = scopeGitMenu(new Menu(), view.contentEl);
    view.menus.add(menu); menu.onHide(() => view.menus.delete(menu));
    for (const [key, label] of [["align", "Align changed blocks"], ["sync", "Synchronize scrolling"], ["wrap", "Soft wraps"]]) {
        menu.addItem(item => item.setTitle(label).setChecked(key === "sync" && view.align ? true : !!view[key])
            .setDisabled(key === "sync" && view.align)
            .onClick(() => { view[key] = !view[key]; view.savePreferences?.(); view.render(); }));
    }
    menu.showAtMouseEvent(event);
}
