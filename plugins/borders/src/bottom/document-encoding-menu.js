import { Menu, Notice } from "obsidian";
import { scopeModule } from "../../../utils/module-scope";

/** Footer UI delegates file conversion to the document owner. */
export class DocumentEncodingMenu {
    show(anchor, content, snapshot, context) {
        this.dispose();
        if (!content?.setEncoding || !snapshot?.location || !snapshot.canChangeEncoding) return;
        const menu = new Menu();
        menu.dom.classList.add("pw-encoding-menu");
        const scope = scopeModule(menu.dom, "borders", { surface: "encoding-menu" });
        scope.refreshTokens(anchor);
        this.menu = menu;
        menu.onHide(() => { scope.dispose(); if (this.menu === menu) this.menu = undefined; });
        menu.addItem(item => item.setTitle("File encoding").setDisabled(true));
        for (const encoding of ["UTF-8", "UTF-8 BOM", "UTF-16 LE", "UTF-16 BE", "GBK", "GB2312", "ASCII"]) {
            menu.addItem(item => item.setTitle(encoding).setChecked(snapshot.encoding === encoding).onClick(() => {
                void content.setEncoding(snapshot.location, context, encoding).catch(error => new Notice(error.message));
            }));
        }
        menu.addSeparator();
        menu.addItem(item => item.setTitle("Keep Editor enabled").setDisabled(true));
        const rect = anchor.getBoundingClientRect();
        menu.showAtPosition({ x: rect.left, y: rect.top, left: true });
    }

    dispose() { this.menu?.hide(); this.menu = undefined; }
}
