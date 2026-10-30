import { Notice, setTooltip } from "obsidian";
import { setIcon } from "../../../utils/icons";
import { DocumentFileLock } from "./document-file-lock";
import { DocumentBreadcrumbNavigation } from "./document-breadcrumb-navigation";
import { outlineLabel } from "./utils/outline-headings";

/** A full-width document footer, using the existing native word-count item. */
export function installDocumentStatusBar(plugin) {
    const { app } = plugin;
    const doc = app.workspace.containerEl.ownerDocument;
    const bar = doc.querySelector(".status-bar");
    if (!bar || !app.vault.adapter.getFullPath) return;
    let disposed = false;
    let scheduled = false;
    let currentLeaf;
    let shownPath;
    let selectedHeading;
    let browsingFolder;
    const positions = new Map();
    const create = (tag, cls) => {
        const el = doc.createElement(tag);
        el.className = `status-bar-item ${cls}`;
        bar.append(el);
        return el;
    };
    const breadcrumb = create("nav", "pw-status-path");
    const position = create("span", "pw-status-position");
    const encoding = create("span", "pw-status-encoding");
    const lock = create("button", "clickable-icon pw-status-lock");
    lock.type = "button";
    const schedule = () => {
        if (scheduled || disposed) return;
        scheduled = true;
        queueMicrotask(() => { scheduled = false; if (!disposed) render(); });
    };
    const locks = new DocumentFileLock(plugin, schedule);
    plugin.documentFileLock = locks;
    const selectedAnchor = (path, line) => new Promise(resolve => {
        schedule();
        queueMicrotask(() => resolve(disposed ? undefined : [...breadcrumb.querySelectorAll("button")].find(button =>
            button.dataset.path === path && button.dataset.line === (Number.isInteger(line) ? String(line) : undefined))));
    });
    const navigation = new DocumentBreadcrumbNavigation(plugin, (file, line) => {
        browsingFolder = undefined;
        selectedHeading = Number.isInteger(line) ? { path: file.path, line } : undefined;
        return selectedAnchor(file.path, line);
    }, folder => {
        browsingFolder = folder;
        selectedHeading = undefined;
        return selectedAnchor(folder.path);
    });

    const documents = () => {
        const leaves = [];
        app.workspace.iterateAllLeaves(leaf => {
            if (leaf.view.file && leaf.view.containerEl.closest(".mod-root")) leaves.push(leaf);
        });
        return leaves;
    };
    const select = leaf => {
        if (!leaf?.view.containerEl.closest(".mod-root")) return;
        currentLeaf = leaf;
        browsingFolder = undefined;
        schedule();
    };
    const pathButton = (label, path, heading) => {
        const button = doc.createElement("button");
        button.type = "button";
        button.textContent = label;
        button.dataset.path = path;
        if (heading) button.dataset.line = String(heading.heading.position.start.line);
        button.setAttribute("aria-haspopup", "menu");
        button.setAttribute("aria-expanded", "false");
        button.addEventListener("click", () => {
            const target = app.vault.getAbstractFileByPath(path);
            if (target) navigation.show(button, target, currentLeaf, heading);
        });
        breadcrumb.append(button);
    };
    const renderPath = (file, view) => {
        if (browsingFolder && app.vault.getAbstractFileByPath(browsingFolder.path) !== browsingFolder) browsingFolder = undefined;
        const path = browsingFolder?.path ?? file?.path ?? "/";
        const line = view?.getMode?.() === "source" ? view.editor?.getCursor?.().line
            : selectedHeading?.path === file?.path ? selectedHeading?.line : undefined;
        const trail = browsingFolder ? [] : navigation.trail(file, line);
        const signature = JSON.stringify([app.vault.getName(), path, trail.map(node => [node.heading.heading, node.heading.position.start.line])]);
        if (shownPath === signature) return;
        shownPath = signature;
        breadcrumb.replaceChildren();
        const parts = path === "/" ? [] : path.split("/");
        pathButton(app.vault.getName(), "/");
        parts.forEach((part, index) => {
            const separator = doc.createElement("span");
            separator.className = "pw-status-separator";
            separator.textContent = "›";
            breadcrumb.append(separator);
            pathButton(part, parts.slice(0, index + 1).join("/"));
        });
        for (const node of trail) {
            const separator = doc.createElement("span");
            separator.className = "pw-status-separator";
            separator.textContent = "›";
            breadcrumb.append(separator);
            pathButton(outlineLabel(node.heading.heading) || node.heading.heading, file.path, node);
        }
    };
    const render = () => {
        const leaves = documents();
        if (!currentLeaf || !app.workspace.isAttached(currentLeaf)) {
            currentLeaf = leaves.find(leaf => leaf === leaf.parent.children[leaf.parent.currentTab]) ?? leaves[0];
        }
        const view = currentLeaf?.view;
        const file = view?.file;
        renderPath(file, view);
        position.hidden = encoding.hidden = lock.hidden = !file;
        lock.disabled = !file || locks.pending.has(file.path) || !locks.info.has(file.path);
        const info = file && locks.info.get(file.path);
        const locked = info?.readOnly === true;
        const icon = locked ? "lock-keyhole" : "lock-keyhole-open";
        if (lock.dataset.icon !== icon) {
            setIcon(lock, icon);
            const svg = lock.querySelector("svg");
            const dot = svg?.querySelector("circle");
            dot?.setAttribute("fill", "currentColor");
            dot?.setAttribute("stroke", "none");
            dot?.setAttribute("r", "1.5");
            if (!locked) {
                svg?.querySelector("rect")?.setAttribute("width", "14");
                dot?.setAttribute("cx", "10");
                svg?.querySelector("path")?.setAttribute("d", "M12 10V6a4 4 0 0 1 8 0v2");
            }
            lock.dataset.icon = icon;
        }
        lock.setAttribute("aria-pressed", String(locked));
        const label = locked ? "Unlock file — allow editing" : "Lock file — read-only";
        if (lock.getAttribute("aria-label") !== label) setTooltip(lock, label, { placement: "top" });
        if (!file) { position.textContent = encoding.textContent = ""; return; }
        const editor = locks.editor(view);
        const preview = view.getMode?.() === "preview";
        let cursor;
        if (!preview && editor?.state) {
            const head = editor.state.selection.main.head;
            const line = editor.state.doc.lineAt(head);
            cursor = `${line.number}:${Array.from(line.text.slice(0, head - line.from)).length + 1}`;
        } else if (!preview && view.editor?.getCursor) {
            const point = view.editor.getCursor();
            cursor = `${point.line + 1}:${point.ch + 1}`;
        }
        if (cursor) positions.set(file.path, cursor);
        position.textContent = cursor ?? positions.get(file.path) ?? "";
        position.hidden = !position.textContent;
        encoding.textContent = info?.encoding ?? "—";
    };
    const refresh = async () => {
        if (disposed) return;
        const views = documents().map(leaf => leaf.view);
        locks.sync(views);
        render();
        await locks.refresh(views);
        if (disposed) return;
        locks.sync(documents().map(leaf => leaf.view));
        render();
    };
    lock.addEventListener("click", () => {
        void locks.toggle(currentLeaf?.view.file).catch(error => new Notice(error.message ?? "Could not change the file attribute."));
    });
    const selectReadingHeading = event => {
        if (event.button !== 0) return;
        const target = event.target.nodeType === 1 ? event.target : event.target.parentElement;
        if (!target || target.closest(".mod-ui, .metadata-container, .inline-title")) return;
        const leaf = documents().find(item => item.view.getMode?.() === "preview"
            && item.view.previewMode?.renderer?.previewEl.contains(target));
        if (!leaf) return;
        const renderer = leaf.view.previewMode.renderer;
        const section = renderer.getSectionForElement(target) ?? renderer.sections.findLast(item =>
            item.el?.getClientRects().length && item.el.getBoundingClientRect().top <= event.clientY);
        const line = section?.start?.line;
        if (!Number.isInteger(line)) return;
        currentLeaf = leaf;
        browsingFolder = undefined;
        selectedHeading = { path: leaf.view.file.path, line };
        schedule();
    };
    plugin.registerDomEvent(doc, "click", selectReadingHeading, true);
    // Prevent editable titles and preview checkboxes from changing a locked file.
    const guard = event => {
        const content = event.target.closest?.(".workspace-leaf-content.pw-file-readonly");
        if (!content) return;
        const changing = event.type !== "click" || event.target.closest("input[type=checkbox], .pw-document-mode-action");
        if (changing) { event.preventDefault(); event.stopImmediatePropagation(); }
    };
    for (const type of ["beforeinput", "paste", "cut", "drop", "click"]) plugin.registerDomEvent(doc, type, guard, true);
    plugin.registerDomEvent(doc, "selectionchange", schedule);
    plugin.registerDomEvent(doc.defaultView, "focus", () => void refresh());
    plugin.registerEvent(app.workspace.on("active-leaf-change", select));
    plugin.registerEvent(app.workspace.on("patchwork:document-tab-activated", select));
    for (const event of ["layout-change", "file-open"]) plugin.registerEvent(app.workspace.on(event, () => void refresh()));
    plugin.registerEvent(app.workspace.on("editor-change", schedule));
    for (const event of ["rename", "modify", "delete"]) plugin.registerEvent(app.vault.on(event, () => void refresh()));
    const interval = doc.defaultView.setInterval(() => void refresh(), 1500);
    doc.body.classList.add("pw-document-footer-enabled");
    select(app.workspace.activeLeaf);
    void refresh();
    plugin.register(() => {
        disposed = true;
        doc.defaultView.clearInterval(interval);
        locks.dispose();
        navigation.dispose();
        if (plugin.documentFileLock === locks) delete plugin.documentFileLock;
        doc.body.classList.remove("pw-document-footer-enabled");
        for (const el of [breadcrumb, position, encoding, lock]) el.remove();
        positions.clear();
    });
}
