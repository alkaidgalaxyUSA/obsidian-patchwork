const ACTIONS = [
    "switcher:Open quick switcher",
    "command-palette:Open command palette",
    "obsidian-git:Open Git source control",
    "meld-encrypt:Lock and close all open encrypted notes",
    "obsidian-excalidraw-plugin:New drawing",
    "realclaudian:Open Claudian",
];
const PANELS = new Map([
    ["realclaudian:Open Claudian", "claudian-view"],
    ["obsidian-git:Open Git source control", "git-view"],
]);

/** Relocate native ribbon controls without replacing their commands or listeners. */
class WindowActions {
    constructor(plugin) {
        this.app = plugin.app;
        this.noteNavigation = plugin.noteNavigation;
        this.entries = new Map();
        this.managedTabs = new Set();
        this.pendingPanels = new Set();
        for (const event of ["layout-change", "active-leaf-change", "file-open"]) {
            plugin.registerEvent(this.app.workspace.on(event, () => this.schedule()));
        }
        this.app.workspace.onLayoutReady(() => this.schedule());
    }

    schedule() {
        if (this.disposed || this.pending) return;
        this.pending = true;
        queueMicrotask(() => {
            this.pending = false;
            if (!this.disposed) this.sync();
        });
    }

    sync() {
        const ribbon = this.app.workspace.leftRibbon;
        const doc = this.app.workspace.containerEl.ownerDocument;
        if (!ribbon?.ribbonItemsEl || !doc.querySelector(".titlebar")) return;
        if (!this.toolbar) this.attach(doc, ribbon);
        if (!this.toolbar.isConnected) doc.body.append(this.toolbar);
        const items = new Map(ribbon.items.map((item) => [item.id, item]));
        for (const [id, entry] of this.entries) {
            // Native ribbon refreshes may temporarily detach our relocated nodes.
            if (items.get(id)?.buttonEl === entry.button) continue;
            this.restore(entry, false);
            this.entries.delete(id);
        }
        for (const id of ACTIONS) {
            const button = items.get(id)?.buttonEl;
            if (!button) continue;
            if (!this.entries.has(id)) {
                const marker = doc.createComment("Patchwork ribbon action");
                button.before(marker);
                const attributes = new Map(["data-tooltip-position", "role", "tabindex", "aria-label"].map((name) => [name, button.getAttribute(name)]));
                button.setAttribute("data-tooltip-position", "bottom");
                button.setAttribute("role", "button");
                button.tabIndex = 0;
                this.entries.set(id, { button, marker, attributes });
            }
            if (id === "meld-encrypt:Lock and close all open encrypted notes") button.setAttribute("aria-label", "Close encrypted notes");
        }
        const buttons = ACTIONS.map((id) => this.entries.get(id)?.button).filter(Boolean);
        buttons.forEach((button, index) => {
            if (this.toolbar.children[index] !== button) this.toolbar.insertBefore(button, this.toolbar.children[index] ?? null);
        });
        doc.body.classList.toggle("pw-window-actions-enabled", buttons.length > 0);
        const tabs = new Set();
        for (const type of PANELS.values()) {
            for (const leaf of this.app.workspace.getLeavesOfType(type)) {
                if (!this.app.workspace.rightSplit.containerEl.contains(leaf.view.containerEl)) continue;
                const tab = leaf.tabHeaderEl;
                if (tab) { tab.classList.add("pw-window-managed-tab"); tabs.add(tab); }
            }
        }
        for (const tab of this.managedTabs) if (!tabs.has(tab)) tab.classList.remove("pw-window-managed-tab");
        this.managedTabs = tabs;
        this.position();
    }

    position() {
        const profile = this.doc.querySelector('.mod-left-split > .workspace-sidedock-vault-profile');
        const profileHeight = profile?.getBoundingClientRect().height;
        if (profileHeight > 0) this.doc.body.style.setProperty("--pw-document-header-height", `${profileHeight}px`);
        const dock = this.app.workspace.rightSplit;
        const header = dock.containerEl.querySelector('.workspace-tabs.mod-top > .workspace-tab-header-container');
        const headerBounds = header?.getBoundingClientRect();
        const documentLeaf = this.noteNavigation.findLeaf(this.doc);
        const imageOpen = documentLeaf?.view.getViewType() === "image" || !!this.doc.querySelector('.lightbox, .mod-image-lightbox');
        const visible = !dock.collapsed && headerBounds?.width > 0 && !imageOpen;
        this.toolbar.hidden = !visible;
        this.doc.body.classList.toggle("pw-window-tools-visible", visible);
        const win = this.doc.defaultView;
        const controls = this.doc.querySelector(".titlebar-button-container.mod-right")?.getBoundingClientRect();
        if (!visible) {
            this.doc.body.style.setProperty("--pw-window-tools-width", "0px");
            // Themes can make native window controls wider than --frame-right-space.
            const rightSpace = controls?.width ? `${Math.ceil(win.innerWidth - controls.left) + 4}px` : "var(--frame-right-space)";
            this.doc.body.style.setProperty("--pw-window-tools-right-space", rightSpace);
            return;
        }
        const width = Math.ceil(this.toolbar.getBoundingClientRect().width);
        const right = controls?.width ? controls.left : win.innerWidth;
        const left = Math.max(headerBounds.left, Math.min(headerBounds.left + 8, right - width - 8));
        this.toolbar.style.left = `${left}px`;
        this.toolbar.style.top = `${headerBounds.top}px`;
        for (const [name, value] of [["--pw-window-tools-width", `${width}px`], ["--pw-window-tools-right-space", `${win.innerWidth - left + 8}px`]]) {
            if (this.doc.body.style.getPropertyValue(name) !== value) this.doc.body.style.setProperty(name, value);
        }
    }

    attach(doc, ribbon) {
        this.doc = doc;
        this.toolbar = doc.createElement("div");
        this.toolbar.className = "pw-window-actions";
        this.toolbar.setAttribute("role", "toolbar");
        this.toolbar.setAttribute("aria-label", "Window shortcuts");
        this.previousWidth = doc.body.style.getPropertyValue("--pw-window-tools-width");
        this.previousWidthPriority = doc.body.style.getPropertyPriority("--pw-window-tools-width");
        this.previousRightSpace = doc.body.style.getPropertyValue("--pw-window-tools-right-space");
        this.previousRightPriority = doc.body.style.getPropertyPriority("--pw-window-tools-right-space");
        this.previousHeaderHeight = doc.body.style.getPropertyValue("--pw-document-header-height");
        this.observer = new doc.defaultView.MutationObserver(() => this.schedule());
        this.observer.observe(ribbon.ribbonItemsEl, { childList: true });
        this.observer.observe(this.toolbar, { childList: true });
        this.observer.observe(doc.body, { childList: true });
        this.resize = new doc.defaultView.ResizeObserver(() => this.position());
        this.resize.observe(this.toolbar);
        this.resize.observe(this.app.workspace.rightSplit.containerEl);
        this.resize.observe(this.app.workspace.containerEl);
        const controls = doc.querySelector(".titlebar-button-container.mod-right");
        if (controls) this.resize.observe(controls);
        const profile = doc.querySelector('.mod-left-split > .workspace-sidedock-vault-profile');
        if (profile) this.resize.observe(profile);
        this.toolbar.addEventListener("keydown", (event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            const button = event.target.closest(".side-dock-ribbon-action");
            if (!button) return;
            event.preventDefault();
            event.stopPropagation();
            button.click();
        });
        this.toolbar.addEventListener("click", async (event) => {
            const id = [...PANELS.keys()].find((id) => this.entries.get(id)?.button.contains(event.target));
            if (!id) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            if (this.pendingPanels.has(id)) return;
            this.pendingPanels.add(id);
            try {
                const leaves = this.app.workspace.getLeavesOfType(PANELS.get(id));
                const leaf = leaves.find((leaf) => leaf.view.containerEl.getClientRects().length) ?? leaves[0];
                if (!leaf) { await ribbon.items.find((item) => item.id === id)?.callback?.(event); return; }
                const dock = [this.app.workspace.rightSplit, this.app.workspace.leftSplit]
                    .find((dock) => dock.containerEl.contains(leaf.view.containerEl));
                if (dock && !dock.collapsed && leaf.view.containerEl.getClientRects().length) dock.collapse();
                else await this.app.workspace.revealLeaf(leaf);
            } finally { this.pendingPanels.delete(id); }
        }, true);
    }

    restore(entry, restoreButton) {
        if (restoreButton && entry.button.parentElement === this.toolbar) {
            if (entry.marker.parentNode) entry.marker.replaceWith(entry.button);
            else this.app.workspace.leftRibbon.ribbonItemsEl.append(entry.button);
        }
        else {
            entry.marker.remove();
            if (entry.button.parentElement === this.toolbar) entry.button.remove();
        }
        for (const [name, value] of entry.attributes) {
            if (value === null) entry.button.removeAttribute(name);
            else entry.button.setAttribute(name, value);
        }
    }

    dispose() {
        this.disposed = true;
        this.observer?.disconnect();
        this.resize?.disconnect();
        const items = this.app.workspace.leftRibbon?.items ?? [];
        for (const entry of this.entries.values()) this.restore(entry, items.some((item) => item.buttonEl === entry.button));
        this.entries.clear();
        for (const tab of this.managedTabs) tab.classList.remove("pw-window-managed-tab");
        this.managedTabs.clear();
        this.toolbar?.remove();
        this.doc?.body.classList.remove("pw-window-actions-enabled", "pw-window-tools-visible");
        if (!this.doc) return;
        if (this.previousHeaderHeight) this.doc.body.style.setProperty("--pw-document-header-height", this.previousHeaderHeight);
        else this.doc.body.style.removeProperty("--pw-document-header-height");
        if (this.previousWidth) this.doc.body.style.setProperty("--pw-window-tools-width", this.previousWidth, this.previousWidthPriority);
        else this.doc.body.style.removeProperty("--pw-window-tools-width");
        if (this.previousRightSpace) this.doc.body.style.setProperty("--pw-window-tools-right-space", this.previousRightSpace, this.previousRightPriority);
        else this.doc.body.style.removeProperty("--pw-window-tools-right-space");
    }
}

export { WindowActions };
