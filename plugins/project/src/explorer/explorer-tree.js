import { setIcon } from "../utils/icons";
import { explorerFileIcon } from "../utils/file-icons";
import { getWindowContext } from "../../../utils/windows";

/** The native virtual tree remains in place beneath its expandable vault row. */
export function installExplorerTree(plugin, view, runtime) {
    const tree = view.tree;
    const host = tree.root.el;
    const children = tree.root.childrenEl;
    const win = host.ownerDocument.defaultView;
    const context = getWindowContext(host.ownerDocument);
    const rootPath = plugin.app.vault.getRoot().path;
    const root = host.createDiv({ cls: "pw-project-vault-root", attr: { role: "treeitem", tabindex: "0", "aria-level": "1", "aria-expanded": "true", "aria-selected": "false" } });
    const arrow = root.createSpan({ cls: "pw-project-vault-arrow", attr: { "aria-hidden": "true" } });
    setIcon(arrow, "chevron-down");
    setIcon(root.createSpan({ cls: "pw-project-vault-icon", attr: { "aria-hidden": "true" } }), "folder-outline");
    root.createEl("strong", { text: plugin.app.vault.getName() });
    const path = plugin.app.vault.adapter.getBasePath?.() ?? plugin.app.vault.getName();
    root.createSpan({ cls: "pw-project-vault-path", text: path });
    root.title = path;
    host.insertBefore(root, children);
    const previousId = children.getAttribute("id");
    const previousRole = children.getAttribute("role");
    const childId = previousId ?? `pw-project-vault-children-${view.leaf.id}`;
    children.id = childId;
    children.setAttribute("role", "group");
    children.classList.add("pw-project-vault-children");
    root.setAttribute("aria-owns", childId);
    root.setAttribute("aria-controls", childId);
    let disposed = false;
    let collapsed = false;
    let frame;
    const icons = new Map();
    const selectRoot = () => {
        tree.clearSelectedDoms();
        tree.setFocusedItem(null);
        tree.activeDom = null;
        runtime.selectionChanged(view, true);
        root.focus({ preventScroll: true });
    };
    const setCollapsed = value => {
        if (collapsed === value) return;
        collapsed = value;
        host.classList.toggle("pw-project-vault-collapsed", value);
        root.setAttribute("aria-expanded", String(!value));
        setIcon(arrow, value ? "chevron-right" : "chevron-down");
        if (!value) tree.infinityScroll.invalidateAll();
    };
    root.addEventListener("click", event => { event.preventDefault(); selectRoot(); });
    root.addEventListener("dblclick", event => { event.preventDefault(); selectRoot(); setCollapsed(!collapsed); });
    root.addEventListener("keydown", event => {
        if (!["Enter", " ", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
        event.preventDefault(); event.stopPropagation();
        selectRoot();
        setCollapsed(event.key === "ArrowLeft" ? true : event.key === "ArrowRight" ? false : !collapsed);
    });
    const stopSelection = runtime.onSelection((current, targets) => {
        if (current.windowId !== context.windowId) return;
        const selected = targets.length === 1 && targets[0].path === rootPath;
        root.classList.toggle("is-selected", selected);
        root.setAttribute("aria-selected", String(selected));
        // Reveal, keyboard navigation and Select Opened File must open the vault first.
        if (targets.length && !selected) setCollapsed(false);
    });
    const paint = () => {
        frame = undefined;
        if (disposed) return;
        const rows = new Set(children.querySelectorAll(".nav-file-title[data-path], .nav-folder-title[data-path]"));
        for (const [row, icon] of icons) if (!rows.has(row)) { icon.remove(); icons.delete(row); }
        for (const row of rows) {
            let icon = icons.get(row);
            if (!icon) {
                icon = row.ownerDocument.createElement("span");
                icon.className = row.matches(".nav-folder-title") ? "pw-project-folder-icon" : "pw-project-file-icon";
                icon.setAttribute("aria-hidden", "true");
                icons.set(row, icon);
            }
            const name = row.matches(".nav-folder-title") ? "folder-outline" : explorerFileIcon(row.dataset.path);
            if (icon.dataset.icon !== name) { setIcon(icon, name); icon.dataset.icon = name; }
            const label = row.querySelector(".nav-file-title-content, .nav-folder-title-content");
            if (label && icon.nextSibling !== label) row.insertBefore(icon, label);
        }
    };
    const schedule = () => { if (!disposed && frame === undefined) frame = win.requestAnimationFrame(paint); };
    const observer = new win.MutationObserver(schedule);
    observer.observe(children, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-path"] });
    paint();
    const searchInput = view.search.searchComponent.inputEl;
    const revealSearch = () => { if (searchInput.value.trim()) setCollapsed(false); };
    searchInput.addEventListener("input", revealSearch);
    return { expand: () => setCollapsed(false), collapse: () => setCollapsed(true), dispose: () => {
        disposed = true;
        observer.disconnect(); stopSelection(); searchInput.removeEventListener("input", revealSearch);
        if (frame !== undefined) win.cancelAnimationFrame(frame);
        for (const icon of icons.values()) icon.remove();
        icons.clear(); root.remove();
        host.classList.remove("pw-project-vault-collapsed");
        children.classList.remove("pw-project-vault-children");
        if (children.getAttribute("id") === childId && previousId === null) children.removeAttribute("id");
        if (children.getAttribute("role") === "group") {
            if (previousRole === null) children.removeAttribute("role"); else children.setAttribute("role", previousRole);
        }
        tree.infinityScroll.invalidateAll();
    } };
}
