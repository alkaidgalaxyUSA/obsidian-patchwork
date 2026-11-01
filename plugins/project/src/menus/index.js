import { Menu, Notice } from "obsidian";
import { scopeModule } from "../../../utils/module-scope";

const PRESETS = [["patchwork", "Patchwork"], ["github", "GitHub Theme"], ["border", "Border"], ["maple", "Maple"]];

/** File-list-only presets: never install a theme stylesheet into the document. */
export function installMenuStyles(plugin) {
    const { app } = plugin;
    const doc = app.workspace.containerEl.ownerDocument;
    const hosts = new Map();
    const menus = new Set();
    let disposed = false;
    const current = () => PRESETS.some(([id]) => id === plugin.settings.explorerAppearance) ? plugin.settings.explorerAppearance : "patchwork";
    const restoreHost = (host, record) => {
        if (host.getAttribute("data-pw-menu-style") !== record.applied) return;
        if (record.previous === null) host.removeAttribute("data-pw-menu-style"); else host.setAttribute("data-pw-menu-style", record.previous);
    };
    const sync = () => {
        if (disposed) return;
        const present = new Set(app.workspace.getLeavesOfType("file-explorer").map(leaf => leaf.view.containerEl));
        for (const [host, record] of hosts) if (!present.has(host)) { restoreHost(host, record); hosts.delete(host); }
        for (const leaf of app.workspace.getLeavesOfType("file-explorer")) {
            const host = leaf.view.containerEl;
            if (host.dataset.pwMenuStyle === current()) continue;
            const record = hosts.get(host) ?? { previous: host.getAttribute("data-pw-menu-style") };
            record.applied = current(); hosts.set(host, record);
            host.dataset.pwMenuStyle = current();
            leaf.view.tree?.infinityScroll?.invalidateAll();
        }
    };
    const append = (menu) => {
        if (disposed) return;
        menus.add(menu);
        if (menu.dom.getAttribute("data-pw-module") !== "project") {
            const scope = scopeModule(menu.dom, "project", { surface: "file-menu" });
            menu.onHide(() => scope.dispose());
        }
        menu.onHide(() => menus.delete(menu));
        menu.addSeparator();
        menu.addItem((item) => {
            item.setSection("pw-menu-appearance").setTitle("Appearance").setIcon("palette");
            const submenu = item.setSubmenu();
            const scope = scopeModule(submenu.dom, "project", { surface: "appearance-menu" });
            submenu.onHide(() => scope.dispose());
            for (const [id, label] of PRESETS) submenu.addItem((option) => {
                option.setTitle(label).setChecked(id === current()).onClick(async () => {
                    if (disposed) return;
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
        disposed = true;
        for (const menu of menus) menu.hide();
        menus.clear();
        for (const [host, record] of hosts) restoreHost(host, record);
        hosts.clear();
    });
}
