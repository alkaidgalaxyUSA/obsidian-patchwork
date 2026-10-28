import { Menu, Notice } from "obsidian";

const PRESETS = [["patchwork", "Patchwork"], ["github", "GitHub Theme"], ["border", "Border"], ["maple", "Maple"]];

/** File-list-only presets: never install a theme stylesheet into the document. */
export function installMenuStyles(plugin) {
    const { app } = plugin;
    const doc = app.workspace.containerEl.ownerDocument;
    const hosts = new Set();
    const menus = new Set();
    const current = () => PRESETS.some(([id]) => id === plugin.settings.explorerAppearance) ? plugin.settings.explorerAppearance : "patchwork";
    const sync = () => {
        for (const leaf of app.workspace.getLeavesOfType("file-explorer")) {
            const host = leaf.view.containerEl;
            if (host.dataset.pwMenuStyle === current()) continue;
            host.dataset.pwMenuStyle = current();
            hosts.add(host);
            leaf.view.tree.infinityScroll.invalidateAll();
        }
    };
    const append = (menu) => {
        menus.add(menu);
        menu.onHide(() => menus.delete(menu));
        menu.addSeparator();
        menu.addItem((item) => {
            item.setSection("pw-menu-appearance").setTitle("Appearance").setIcon("palette");
            const submenu = item.setSubmenu();
            for (const [id, label] of PRESETS) submenu.addItem((option) => {
                option.setTitle(label).setChecked(id === current()).onClick(async () => {
                    plugin.settings.explorerAppearance = id;
                    sync();
                    try { await plugin.persistSettings(); }
                    catch { new Notice("Could not save menu appearance."); }
                });
            });
        });
    };
    for (const event of ["file-menu", "files-menu"]) plugin.registerEvent(app.workspace.on(event, (menu, file, source) => {
        if (source === "file-explorer-context-menu") append(menu);
    }));
    // Empty file-list space has no native file-menu event.
    plugin.registerDomEvent(doc, "contextmenu", (event) => {
        const host = event.target.closest?.('.workspace-leaf-content[data-type="file-explorer"]');
        if (event.defaultPrevented || !host || event.target.closest(".nav-file-title, .nav-folder-title, input, button, .nav-buttons-container")) return;
        event.preventDefault();
        event.stopPropagation();
        const menu = new Menu();
        append(menu);
        menu.showAtMouseEvent(event);
    });
    plugin.registerEvent(app.workspace.on("layout-change", sync));
    app.workspace.onLayoutReady(sync);
    plugin.register(() => {
        for (const menu of menus) menu.hide();
        menus.clear();
        for (const host of hosts) delete host.dataset.pwMenuStyle;
        hosts.clear();
    });
}
