import { outlineLabel } from "./utils/outline-headings.js";

class NoteOutline {
    constructor(plugin, setIcon) {
        this.app = plugin.app;
        this.setIcon = setIcon;
        this.entries = new Map();
        for (const event of ["layout-change", "active-leaf-change", "file-open", "resize"]) {
            plugin.registerEvent(this.app.workspace.on(event, () => this.schedule()));
        }
        plugin.registerEvent(this.app.metadataCache.on("changed", () => this.schedule()));
        plugin.registerEvent(this.app.vault.on("rename", () => this.schedule()));
        this.app.workspace.onLayoutReady(() => this.schedule());
    }

    schedule() {
        if (this.disposed || this.pending) return;
        this.pending = true;
        queueMicrotask(() => {
            this.pending = false;
            if (!this.disposed) this.refresh();
        });
    }

    refresh() {
        const leaves = this.app.workspace.getLeavesOfType("markdown")
            .filter((leaf) => leaf.view.file && leaf.view.containerEl.closest(".mod-root"));
        const views = new Set(leaves.map((leaf) => leaf.view));
        for (const [view, entry] of this.entries) {
            if (views.has(view)) continue;
            entry.cleanup();
            this.entries.delete(view);
        }
        for (const leaf of leaves) {
            const view = leaf.view;
            const entry = this.entries.get(view) || this.attach(leaf);
            this.updateHeadings(entry);
            entry.enabled = entry.headings.length > 0 && this.available(view);
            if (!entry.enabled) this.reset(entry);
            this.renderState(entry);
            this.queueActive(entry);
        }
    }

    available(view) {
        const doc = view.containerEl.ownerDocument;
        const right = this.app.workspace.rightSplit;
        if (right?.containerEl.ownerDocument === doc && !right.collapsed) return false;
        const otherRight = doc.querySelector(".mod-right-split");
        if (otherRight && otherRight !== right?.containerEl && otherRight.getBoundingClientRect().width > 0) return false;
        if (view.containerEl.getBoundingClientRect().width < 800) return false;
        const visible = Array.from(doc.querySelectorAll(".mod-root .workspace-leaf"))
            .filter((element) => element.getClientRects().length && element.getBoundingClientRect().width > 0);
        return visible.length === 1 && visible[0].contains(view.containerEl);
    }

    attach(leaf) {
        const view = leaf.view;
        const doc = view.containerEl.ownerDocument;
        const win = doc.defaultView;
        const root = doc.createElement("aside");
        root.className = "pw-note-outline";
        root.setAttribute("aria-label", "Outline");
        root.hidden = true;
        const rail = root.appendChild(doc.createElement("button"));
        rail.className = "pw-outline-rail";
        rail.type = "button";
        rail.setAttribute("aria-label", "Show outline");
        const panel = root.appendChild(doc.createElement("div"));
        panel.className = "pw-outline-panel";
        const header = panel.appendChild(doc.createElement("div"));
        header.className = "pw-outline-header";
        header.appendChild(doc.createElement("span")).textContent = "Outline";
        const eye = header.appendChild(doc.createElement("button"));
        eye.className = "clickable-icon pw-outline-eye";
        eye.type = "button";
        eye.dataset.tooltipPosition = "top";
        const list = panel.appendChild(doc.createElement("nav"));
        list.className = "pw-outline-list";
        list.setAttribute("aria-label", "Document headings");
        const entry = { leaf, view, root, rail, panel, eye, list, headings: [], items: [], marks: [],
            enabled: false, pinned: false, hovered: false, keyboard: false, active: -1 };
        const listen = (target, type, listener, options) => {
            target.addEventListener(type, listener, options);
            return () => target.removeEventListener(type, listener, options);
        };
        const cleanup = [
            listen(root, "pointerenter", () => { entry.hovered = true; this.renderState(entry); }),
            listen(root, "pointerleave", () => { entry.hovered = false; entry.keyboard = false; this.renderState(entry); }),
            listen(root, "focusin", (event) => {
                if (event.target.matches(":focus-visible")) entry.keyboard = true;
                this.renderState(entry);
            }),
            listen(root, "focusout", (event) => {
                if (root.contains(event.relatedTarget)) return;
                entry.keyboard = false;
                this.renderState(entry);
            }),
            listen(rail, "click", () => { entry.keyboard = true; this.renderState(entry); eye.focus(); }),
            listen(eye, "click", () => {
                if (!entry.enabled || !this.available(view)) return;
                entry.pinned = !entry.pinned;
                this.renderState(entry);
            }),
            listen(root, "keydown", (event) => {
                if (event.key !== "Escape") return;
                event.preventDefault();
                event.stopPropagation();
                this.reset(entry);
                this.renderState(entry);
            }),
            listen(view.containerEl, "scroll", (event) => {
                if (!root.contains(event.target)) this.queueActive(entry);
            }, true),
        ];
        const resize = new win.ResizeObserver(() => this.schedule());
        resize.observe(view.containerEl);
        const mode = new win.MutationObserver(() => this.schedule());
        mode.observe(view.containerEl, { attributes: true, attributeFilter: ["data-mode"] });
        view.containerEl.append(root);
        entry.cleanup = () => {
            cleanup.forEach((remove) => remove());
            resize.disconnect();
            mode.disconnect();
            if (entry.frame) win.cancelAnimationFrame(entry.frame);
            if (entry.jumpFrame) win.cancelAnimationFrame(entry.jumpFrame);
            root.remove();
        };
        this.entries.set(view, entry);
        return entry;
    }

    updateHeadings(entry) {
        const { view, list, rail } = entry;
        const headings = this.app.metadataCache.getFileCache(view.file)?.headings || [];
        const signature = JSON.stringify([view.file.path, headings.map(({ heading, level, position }) => [heading, level, position.start.line])]);
        if (entry.signature === signature) return;
        if (entry.path !== view.file.path) this.reset(entry);
        entry.path = view.file.path;
        entry.signature = signature;
        entry.headings = headings;
        entry.active = -1;
        list.replaceChildren();
        rail.replaceChildren();
        entry.marks = [];
        entry.items = headings.map((heading, index) => {
            const label = outlineLabel(heading.heading) || heading.heading;
            const button = list.ownerDocument.createElement("button");
            button.type = "button";
            button.className = "pw-outline-item";
            button.textContent = label;
            button.title = label;
            button.style.setProperty("--pw-outline-level", heading.level - 1);
            button.addEventListener("click", () => {
                if (!entry.enabled || !this.available(view)) return;
                this.app.workspace.setActiveLeaf(entry.leaf, { focus: false });
                view.setEphemeralState({ line: heading.position.start.line });
                this.setActive(entry, index);
                if (view.containerEl.dataset.mode !== "preview") {
                    const win = entry.root.ownerDocument.defaultView;
                    if (entry.jumpFrame) win.cancelAnimationFrame(entry.jumpFrame);
                    entry.jumpFrame = win.requestAnimationFrame(() => {
                        entry.jumpFrame = undefined;
                        view.currentMode.applyScroll(heading.position.start.line);
                        this.queueActive(entry);
                    });
                }
                this.queueActive(entry);
            });
            list.append(button);
            const mark = rail.appendChild(rail.ownerDocument.createElement("span"));
            mark.style.setProperty("--pw-outline-level", heading.level - 1);
            mark.setAttribute("aria-hidden", "true");
            entry.marks.push(mark);
            return button;
        });
    }

    reset(entry) {
        if (entry.jumpFrame) entry.root.ownerDocument.defaultView.cancelAnimationFrame(entry.jumpFrame);
        entry.jumpFrame = undefined;
        entry.pinned = false;
        entry.hovered = false;
        entry.keyboard = false;
        const active = entry.root.ownerDocument.activeElement;
        if (entry.root.contains(active)) active.blur();
    }

    renderState(entry) {
        entry.root.hidden = !entry.enabled;
        const expanded = entry.enabled && (entry.pinned || entry.hovered || entry.keyboard);
        const wasExpanded = entry.root.dataset.expanded === "true";
        entry.root.dataset.expanded = String(expanded);
        entry.root.dataset.pinned = String(entry.pinned);
        entry.rail.setAttribute("aria-expanded", String(expanded));
        entry.rail.tabIndex = expanded ? -1 : 0;
        entry.panel.inert = !expanded;
        const icon = entry.pinned ? "eye-closed" : "eye";
        if (entry.eye.dataset.icon !== icon) {
            this.setIcon(entry.eye, icon);
            entry.eye.dataset.icon = icon;
            entry.eye.setAttribute("aria-label", entry.pinned ? "Enable auto-hide" : "Pin outline");
            entry.eye.setAttribute("aria-pressed", String(entry.pinned));
        }
        if (expanded && !wasExpanded) this.revealActive(entry);
    }

    queueActive(entry) {
        if (this.disposed || entry.frame || !entry.enabled) return;
        const win = entry.root.ownerDocument.defaultView;
        entry.frame = win.requestAnimationFrame(() => {
            entry.frame = undefined;
            if (this.disposed || !entry.enabled) return;
            const line = entry.view.currentMode?.getScroll?.() ?? 0;
            let index = 0;
            entry.headings.forEach((heading, current) => {
                if (heading.position.start.line <= line + 0.5) index = current;
            });
            const scroller = entry.view.containerEl.dataset.mode === "preview"
                ? entry.view.previewMode.containerEl.querySelector(".markdown-preview-view") : entry.view.editor?.cm?.scrollDOM;
            if (scroller && scroller.scrollHeight > scroller.clientHeight
                && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2) index = entry.items.length - 1;
            this.setActive(entry, index);
        });
    }

    setActive(entry, index) {
        if (entry.active === index) return;
        entry.active = index;
        entry.items.forEach((item, current) => {
            item.classList.toggle("is-active", current === index);
            if (current === index) item.setAttribute("aria-current", "location");
            else item.removeAttribute("aria-current");
            entry.marks[current].classList.toggle("is-active", current === index);
        });
        if (entry.root.dataset.expanded !== "true") return;
        this.revealActive(entry);
    }

    revealActive(entry) {
        const item = entry.items[entry.active];
        if (!item) return;
        const bounds = item.getBoundingClientRect();
        const list = entry.list.getBoundingClientRect();
        if (bounds.top < list.top) entry.list.scrollTop += bounds.top - list.top;
        else if (bounds.bottom > list.bottom) entry.list.scrollTop += bounds.bottom - list.bottom;
    }

    dispose() {
        this.disposed = true;
        for (const entry of this.entries.values()) entry.cleanup();
        this.entries.clear();
    }
}

export { NoteOutline };
