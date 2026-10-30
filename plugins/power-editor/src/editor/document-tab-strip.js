import { Menu, setTooltip } from "obsidian";
import { setIcon } from "../../../utils/icons";
import { useManualMenuScroll } from "../../../utils/menu-scroll";
import { activateDocumentTab } from "./document-tabs";
import { installDocumentTabDrag } from "./document-tab-drag";
import { DocumentTabMenu } from "./document-tab-menu";

/** Native tab groups and drag ordering, with non-shrinking tabs and an overflow picker. */
export function installDocumentTabStrip(plugin) {
    const { app } = plugin;
    const tabMenu = new DocumentTabMenu(plugin);
    const entries = new Map();
    let disposed = false;
    let scheduled = false;
    const filePath = (leaf) => {
        const path = leaf.view.file?.path;
        return path && (app.vault.adapter.getFullPath?.(path) ?? path);
    };
    const updateTooltip = (leaf) => {
        const path = filePath(leaf);
        if (path) setTooltip(leaf.tabHeaderEl, path, { classes: ["pw-tab-path-tooltip"], delay: 300 });
    };
    const destroy = (entry) => {
        entry.observer.disconnect();
        entry.resize.disconnect();
        entry.disposeDrag();
        entry.container.removeEventListener("pointerover", entry.tooltip, true);
        entry.win.cancelAnimationFrame(entry.frame);
        entry.menu?.hide();
        tabMenu.close(entry.tabs);
        entry.more.removeEventListener("click", entry.openOptions, true);
        entry.more.removeEventListener("keydown", entry.optionsKeydown);
        entry.overflow.remove();
        entry.spacer.remove();
        entry.contentHeader.before(entry.container);
        entry.contentHeader.remove();
        entry.titlebarSpace.remove();
        entry.container.classList.remove("pw-document-tab-strip");
        entry.more.replaceChildren(...entry.moreChildren);
        entry.more.parentElement.hidden = entry.moreHidden;
        if (entry.moreLabel === null) entry.more.removeAttribute("aria-label");
        else entry.more.setAttribute("aria-label", entry.moreLabel);
        for (const [name, value] of entry.moreAttributes) {
            if (value === null) entry.more.removeAttribute(name);
            else entry.more.setAttribute(name, value);
        }
        for (const leaf of entry.tabs.children) leaf.updateHeader();
    };
    const attach = (tabs) => {
        const container = tabs.tabHeaderContainerEl;
        const inner = tabs.tabsInnerEl;
        const more = container.querySelector(".workspace-tab-header-tab-list > .clickable-icon");
        if (!more) return;
        const doc = container.ownerDocument;
        const win = doc.defaultView;
        const overflow = doc.createElement("button");
        overflow.type = "button";
        overflow.className = "clickable-icon pw-tab-overflow";
        overflow.setAttribute("aria-label", "Open tabs");
        overflow.setAttribute("aria-haspopup", "menu");
        overflow.setAttribute("aria-expanded", "false");
        overflow.hidden = true;
        setIcon(overflow, "chevron-down");
        const spacer = doc.createElement("div");
        spacer.className = "pw-tab-actions-spacer";
        spacer.setAttribute("aria-hidden", "true");
        more.parentElement.before(spacer, overflow);
        const entry = { tabs, container, inner, more, overflow, spacer, win, frame: 0,
            moreChildren: [...more.childNodes], moreLabel: more.getAttribute("aria-label"), moreHidden: more.parentElement.hidden };
        setIcon(more, "ellipsis-vertical");
        more.setAttribute("aria-label", "Recent files, Tab Actions, and More");
        more.parentElement.hidden = !tabs.children.some(leaf => leaf.view.file);
        entry.moreAttributes = new Map(["role", "tabindex", "aria-haspopup", "aria-expanded"].map(name => [name, more.getAttribute(name)]));
        more.setAttribute("role", "button");
        more.tabIndex = 0;
        more.setAttribute("aria-haspopup", "menu");
        more.setAttribute("aria-expanded", "false");
        entry.openOptions = event => {
            event.preventDefault(); event.stopImmediatePropagation();
            if (!tabs.children.some(leaf => leaf.view.file)) return;
            entry.menu?.hide();
            tabMenu.show(tabs, more);
        };
        entry.optionsKeydown = event => {
            if (event.key === "Enter" || event.key === " ") entry.openOptions(event);
        };
        more.addEventListener("click", entry.openOptions, true);
        more.addEventListener("keydown", entry.optionsKeydown);
        container.classList.add("pw-document-tab-strip");
        entry.contentHeader = doc.createElement("div");
        entry.contentHeader.className = "pw-document-top-area";
        entry.titlebarSpace = doc.createElement("div");
        entry.titlebarSpace.className = "pw-document-titlebar-space";
        entry.titlebarSpace.setAttribute("aria-hidden", "true");
        container.before(entry.titlebarSpace);
        container.after(entry.contentHeader);
        entry.contentHeader.append(container);
        entry.disposeDrag = installDocumentTabDrag(app, tabs);
        entry.tooltip = (event) => {
            const header = event.target.closest?.(".workspace-tab-header");
            const leaf = tabs.children.find((item) => item.tabHeaderEl === header);
            if (leaf) updateTooltip(leaf);
        };
        container.addEventListener("pointerover", entry.tooltip, true);
        const measure = () => {
            entry.frame = 0;
            if (disposed || !container.isConnected) return;
            const hasFile = tabs.children.some(leaf => leaf.view.file);
            more.parentElement.hidden = !hasFile;
            spacer.hidden = !hasFile;
            if (!hasFile) {
                overflow.hidden = true;
                entry.menu?.hide();
                tabMenu.close(tabs);
                return;
            }
            if (container.classList.contains("pw-tab-dragging")) return;
            for (const leaf of tabs.children) updateTooltip(leaf);
            const style = win.getComputedStyle(inner);
            const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
            const gap = parseFloat(style.columnGap) || 0;
            const needed = tabs.children.reduce((width, leaf) => width + leaf.tabHeaderEl.getBoundingClientRect().width, padding)
                + Math.max(0, tabs.children.length - 1) * gap;
            // Include the arrow's current space to avoid a sticky overflow state
            // when closing tabs makes everything fit again.
            const available = inner.clientWidth + (overflow.hidden ? 0 : overflow.getBoundingClientRect().width + (parseFloat(win.getComputedStyle(overflow).marginRight) || 0));
            overflow.hidden = tabs.isStacked || needed <= available + 1;
            if (overflow.hidden) entry.menu?.hide();
            const active = tabs.children[tabs.currentTab]?.tabHeaderEl;
            if (!active || tabs.isStacked) return;
            const bounds = inner.getBoundingClientRect();
            const rect = active.getBoundingClientRect();
            if (rect.left < bounds.left) inner.scrollLeft += rect.left - bounds.left;
            else if (rect.right > bounds.right) inner.scrollLeft += rect.right - bounds.right;
        };
        entry.schedule = () => {
            if (!entry.frame) entry.frame = win.requestAnimationFrame(measure);
        };
        overflow.addEventListener("click", () => {
            if (entry.menu) { entry.menu.hide(); return; }
            const menu = new Menu();
            menu.setParentElement(overflow);
            menu.dom.classList.add("pw-open-tabs-menu");
            useManualMenuScroll(menu);
            const names = new Map();
            for (const leaf of tabs.children) {
                const name = leaf.view.getDisplayText();
                names.set(name, (names.get(name) ?? 0) + 1);
            }
            for (const leaf of tabs.children) {
                const name = leaf.view.getDisplayText();
                const path = leaf.view.file?.path;
                const label = names.get(name) > 1 && path ? `${name} — ${leaf.view.file.parent?.path ?? "/"}` : name;
                menu.addItem((item) => {
                    item.setTitle(label).setChecked(leaf === tabs.children[tabs.currentTab]).onClick(async () => {
                        if (!tabs.children.includes(leaf)) return;
                        await activateDocumentTab(app, leaf);
                    });
                    if (path) item.dom.setAttribute("title", filePath(leaf));
                });
            }
            entry.menu = menu;
            overflow.setAttribute("aria-expanded", "true");
            menu.onHide(() => {
                if (entry.menu === menu) entry.menu = undefined;
                overflow.setAttribute("aria-expanded", "false");
            });
            const rect = overflow.getBoundingClientRect();
            menu.showAtPosition({ x: rect.left, y: rect.bottom + 4 });
        });
        entry.resize = new win.ResizeObserver(entry.schedule);
        entry.resize.observe(container);
        entry.resize.observe(inner);
        entry.observer = new win.MutationObserver(entry.schedule);
        entry.observer.observe(inner, { childList: true, subtree: true, characterData: true });
        entries.set(tabs, entry);
        entry.schedule();
    };
    const sync = () => {
        if (disposed) return;
        const groups = new Set();
        app.workspace.iterateAllLeaves((leaf) => {
            if (leaf.view.containerEl.closest(".mod-root") && leaf.parent?.type === "tabs") groups.add(leaf.parent);
        });
        for (const [tabs, entry] of entries) if (!groups.has(tabs) || !entry.container.isConnected) { destroy(entry); entries.delete(tabs); }
        for (const tabs of groups) {
            if (!entries.has(tabs)) attach(tabs);
            else entries.get(tabs).schedule();
        }
    };
    const schedule = () => {
        if (scheduled || disposed) return;
        scheduled = true;
        queueMicrotask(() => { scheduled = false; sync(); });
    };
    for (const event of ["layout-change", "active-leaf-change", "file-open", "window-open"]) plugin.registerEvent(app.workspace.on(event, schedule));
    plugin.registerEvent(app.workspace.on("patchwork:document-tab-activated", (leaf) => entries.get(leaf.parent)?.schedule()));
    plugin.registerEvent(app.workspace.on("tab-group-menu", (menu, tabs) => {
        if (!entries.has(tabs)) return;
        // Native code appends tab-list items after this event, before showing the menu.
        queueMicrotask(() => {
            if (disposed) return;
            menu.items = menu.items.filter((item) => item.section !== "tablist");
            menu.sort();
        });
    }));
    app.workspace.onLayoutReady(schedule);
    plugin.register(() => { disposed = true; for (const entry of entries.values()) destroy(entry); entries.clear(); });
}
