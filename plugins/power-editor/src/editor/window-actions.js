import { setIcon } from "../../../utils/icons";
import { PanelFocus } from "../../../utils/panel-focus";
import { TabActionsPosition } from "./tab-actions-position";
import { VaultHeader } from "./vault-header";

const TITLEBAR_ACTIONS = [
    "switcher:Open quick switcher",
    "command-palette:Open command palette",
    "meld-encrypt:Lock and close all open encrypted notes",
    "obsidian-excalidraw-plugin:New drawing",
];
const ACTIONS = [
    ...TITLEBAR_ACTIONS,
    "realclaudian:Open Claudian",
];
const PANELS = new Map([
    ["realclaudian:Open Claudian", "claudian-view"],
]);

/** Relocate native ribbon controls without replacing their commands or listeners. */
class WindowActions {
    constructor(plugin) {
        this.app = plugin.app;
        this.entries = new Map();
        this.managedTabs = new Set();
        this.pendingPanels = new Set();
        this.panelFocus = new PanelFocus(plugin, () => [
            { id: "project", button: this.leftToggle, leaves: this.projectLeaves() },
            ...[...PANELS].map(([id, type]) => ({ id, button: this.entries.get(id)?.button, leaves: this.app.workspace.getLeavesOfType(type) })),
        ]);
        for (const event of ["layout-change", "active-leaf-change", "file-open"]) {
            plugin.registerEvent(this.app.workspace.on(event, () => this.schedule()));
        }
        this.app.workspace.onLayoutReady(() => this.schedule());
    }

    schedule() {
        if (this.disposed || this.pending) return;
        this.pending = true;
        this.frame = this.app.workspace.containerEl.ownerDocument.defaultView.requestAnimationFrame(() => {
            this.pending = false;
            if (!this.disposed) this.sync();
        });
    }

    sync() {
        const ribbon = this.app.workspace.leftRibbon;
        const doc = this.app.workspace.containerEl.ownerDocument;
        if (!ribbon?.ribbonItemsEl || !this.app.workspace.rightRibbon?.containerEl || !doc.querySelector(".titlebar")) return;
        if (!this.toolbar) this.attach(doc, ribbon);
        if (this.toolbar.parentElement !== this.rightRibbon) this.rightRibbon.append(this.toolbar);
        if (this.leftToggle.parentElement !== ribbon.containerEl) ribbon.containerEl.prepend(this.leftToggle);
        this.syncSettings();
        this.vaultHeader.sync();
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
                const attributes = new Map(["data-tooltip-position", "role", "tabindex", "aria-label", "aria-pressed"].map((name) => [name, button.getAttribute(name)]));
                button.setAttribute("data-tooltip-position", TITLEBAR_ACTIONS.includes(id) ? "bottom" : "left");
                button.setAttribute("role", "button");
                button.tabIndex = 0;
                this.entries.set(id, { button, marker, attributes });
            }
            if (id === "meld-encrypt:Lock and close all open encrypted notes") button.setAttribute("aria-label", "Close encrypted notes");
        }
        for (const [host, ids] of [[this.titleToolbar, TITLEBAR_ACTIONS], [this.toolbar, ACTIONS.filter(id => !TITLEBAR_ACTIONS.includes(id))]]) {
            const buttons = ids.map(id => this.entries.get(id)?.button).filter(Boolean);
            buttons.forEach((button, index) => {
                if (host.children[index] !== button) host.insertBefore(button, host.children[index] ?? null);
            });
        }
        doc.body.classList.add("pw-window-actions-enabled");
        const projectVisible = this.projectLeaves().some((leaf) => this.isVisible(leaf));
        this.leftToggle.setAttribute("aria-label", "Project");
        this.leftToggle.setAttribute("aria-expanded", String(projectVisible));
        this.leftToggle.setAttribute("aria-pressed", String(projectVisible));
        for (const [id, type] of PANELS) {
            const button = this.entries.get(id)?.button;
            const visible = this.app.workspace.getLeavesOfType(type).some((leaf) => this.isVisible(leaf));
            button?.setAttribute("aria-pressed", String(visible));
        }
        this.panelFocus.sync();
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
        const win = this.doc.defaultView;
        const controls = this.doc.querySelector(".titlebar-button-container.mod-right")?.getBoundingClientRect();
        // Reserve the titlebar shortcuts, Settings and native window controls.
        const rightSpace = controls?.width ? `${Math.ceil(win.innerWidth - controls.left) + 4}px` : "var(--frame-right-space)";
        if (this.doc.body.style.getPropertyValue("--pw-window-tools-right-space") !== rightSpace) {
            this.doc.body.style.setProperty("--pw-window-tools-right-space", rightSpace);
        }
        this.tabActions.sync();
    }

    projectLeaves() {
        return this.app.workspace.getLeavesOfType("file-explorer")
            .filter((leaf) => this.app.workspace.leftSplit.containerEl.contains(leaf.view.containerEl));
    }

    syncSettings() {
        const controls = this.doc.querySelector(".titlebar-button-container.mod-right");
        const minimize = controls?.querySelector(".mod-minimize");
        const button = this.doc.querySelector(".workspace-drawer-vault-actions .clickable-icon:has(.lucide-settings)") ?? this.settings?.button;
        if (!minimize || !button) return;
        if (this.settings && this.settings.button !== button) this.restoreSettings();
        if (!this.settings) {
            const marker = this.doc.createComment("Patchwork settings action");
            button.before(marker);
            const attributes = new Map(["role", "tabindex", "aria-label", "data-tooltip-position"].map((name) => [name, button.getAttribute(name)]));
            const keydown = (event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                event.stopPropagation();
                button.click();
            };
            button.classList.add("pw-window-settings");
            button.setAttribute("role", "button");
            button.setAttribute("aria-label", "Settings");
            button.setAttribute("data-tooltip-position", "bottom");
            button.tabIndex = 0;
            button.addEventListener("keydown", keydown);
            this.settings = { button, marker, attributes, keydown, controls };
        }
        if (button.nextElementSibling !== minimize) controls.insertBefore(button, minimize);
        if (this.titleToolbar.nextElementSibling !== button) controls.insertBefore(this.titleToolbar, button);
    }

    restoreSettings() {
        if (!this.settings) return;
        const { button, marker, attributes, keydown, controls } = this.settings;
        if (button.parentElement === controls && marker.parentNode) marker.replaceWith(button);
        else marker.remove();
        button.classList.remove("pw-window-settings");
        button.removeEventListener("keydown", keydown);
        for (const [name, value] of attributes) {
            if (value === null) button.removeAttribute(name);
            else button.setAttribute(name, value);
        }
        this.settings = undefined;
    }

    isVisible(leaf) {
        const dock = [this.app.workspace.rightSplit, this.app.workspace.leftSplit]
            .find((dock) => dock.containerEl.contains(leaf.view.containerEl));
        if (dock?.collapsed) return false;
        if (!leaf.tabHeaderEl?.classList.contains("is-active")) return false;
        const bounds = leaf.view.containerEl.getBoundingClientRect();
        return bounds.width > 0 && bounds.height > 0;
    }

    attach(doc, ribbon) {
        this.doc = doc;
        this.tabActions = new TabActionsPosition(doc);
        this.vaultHeader = new VaultHeader(this.app, doc);
        this.rightRibbon = this.app.workspace.rightRibbon.containerEl;
        this.toolbar = doc.createElement("div");
        this.toolbar.className = "pw-window-actions";
        this.toolbar.setAttribute("role", "toolbar");
        this.toolbar.setAttribute("aria-label", "Right sidebar shortcuts");
        this.toolbar.setAttribute("aria-orientation", "vertical");
        this.titleToolbar = doc.createElement("div");
        this.titleToolbar.className = "pw-titlebar-shortcuts";
        this.titleToolbar.setAttribute("role", "toolbar");
        this.titleToolbar.setAttribute("aria-label", "Titlebar shortcuts");
        this.titleToolbar.setAttribute("aria-orientation", "horizontal");
        this.leftToggle = doc.createElement("button");
        this.leftToggle.type = "button";
        this.leftToggle.className = "clickable-icon pw-left-sidebar-toggle";
        this.leftToggle.setAttribute("data-tooltip-position", "right");
        setIcon(this.leftToggle, "folder-outline");
        this.leftToggle.addEventListener("click", async () => {
            const dock = this.app.workspace.leftSplit;
            const leaf = this.projectLeaves()[0];
            if (leaf && !this.isVisible(leaf)) await this.app.workspace.revealLeaf(leaf);
            else if (dock.collapsed) dock.expand();
            else dock.collapse();
            this.schedule();
        });
        this.previousRightSpace = doc.body.style.getPropertyValue("--pw-window-tools-right-space");
        this.previousRightPriority = doc.body.style.getPropertyPriority("--pw-window-tools-right-space");
        this.previousHeaderHeight = doc.body.style.getPropertyValue("--pw-document-header-height");
        this.observer = new doc.defaultView.MutationObserver(() => this.schedule());
        this.observer.observe(ribbon.ribbonItemsEl, { childList: true });
        this.observer.observe(this.toolbar, { childList: true });
        this.observer.observe(this.titleToolbar, { childList: true });
        this.observer.observe(ribbon.containerEl, { childList: true });
        this.observer.observe(this.rightRibbon, { childList: true });
        this.observer.observe(this.app.workspace.leftSplit.containerEl, { attributes: true, attributeFilter: ["class", "style"] });
        this.observer.observe(this.app.workspace.rightSplit.containerEl, { attributes: true, attributeFilter: ["class", "style"] });
        // Sidebar tab switches can leave the workspace's active leaf unchanged.
        this.panelObserver = new doc.defaultView.MutationObserver(records => {
            if (records.some(record => record.target.matches(".workspace-leaf, .workspace-tab-header"))) this.schedule();
        });
        for (const dock of [this.app.workspace.leftSplit, this.app.workspace.rightSplit]) {
            this.panelObserver.observe(dock.containerEl, { subtree: true, attributes: true, attributeFilter: ["class", "style"] });
        }
        this.resize = new doc.defaultView.ResizeObserver(() => this.position());
        this.resize.observe(this.toolbar);
        this.resize.observe(this.titleToolbar);
        this.resize.observe(this.app.workspace.rightSplit.containerEl);
        this.resize.observe(this.app.workspace.containerEl);
        const controls = doc.querySelector(".titlebar-button-container.mod-right");
        if (controls) {
            this.resize.observe(controls);
            this.observer.observe(controls, { childList: true });
        }
        const profile = doc.querySelector('.mod-left-split > .workspace-sidedock-vault-profile');
        if (profile) this.resize.observe(profile);
        const activateShortcut = (event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            const button = event.target.closest(".side-dock-ribbon-action");
            if (!button) return;
            event.preventDefault();
            event.stopPropagation();
            button.click();
        };
        this.toolbar.addEventListener("keydown", activateShortcut);
        this.titleToolbar.addEventListener("keydown", activateShortcut);
        this.toolbar.addEventListener("click", async (event) => {
            const id = [...PANELS.keys()].find((id) => this.entries.get(id)?.button.contains(event.target));
            if (!id) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            if (this.pendingPanels.has(id)) return;
            this.pendingPanels.add(id);
            try {
                const leaves = this.app.workspace.getLeavesOfType(PANELS.get(id));
                const leaf = leaves.find((leaf) => this.isVisible(leaf)) ?? leaves[0];
                if (!leaf) { await ribbon.items.find((item) => item.id === id)?.callback?.(event); return; }
                const dock = [this.app.workspace.rightSplit, this.app.workspace.leftSplit]
                    .find((dock) => dock.containerEl.contains(leaf.view.containerEl));
                if (dock && this.isVisible(leaf)) dock.collapse();
                else await this.app.workspace.revealLeaf(leaf);
            } finally {
                this.pendingPanels.delete(id);
                this.schedule();
            }
        }, true);
    }

    restore(entry, restoreButton) {
        const relocated = entry.button.parentElement === this.toolbar || entry.button.parentElement === this.titleToolbar;
        if (restoreButton && relocated) {
            if (entry.marker.parentNode) entry.marker.replaceWith(entry.button);
            else this.app.workspace.leftRibbon.ribbonItemsEl.append(entry.button);
        }
        else {
            entry.marker.remove();
            if (relocated) entry.button.remove();
        }
        for (const [name, value] of entry.attributes) {
            if (value === null) entry.button.removeAttribute(name);
            else entry.button.setAttribute(name, value);
        }
    }

    dispose() {
        this.disposed = true;
        this.app.workspace.containerEl.ownerDocument.defaultView.cancelAnimationFrame(this.frame);
        this.observer?.disconnect();
        this.panelObserver?.disconnect();
        this.resize?.disconnect();
        this.tabActions?.dispose();
        const items = this.app.workspace.leftRibbon?.items ?? [];
        for (const entry of this.entries.values()) this.restore(entry, items.some((item) => item.buttonEl === entry.button));
        this.entries.clear();
        for (const tab of this.managedTabs) tab.classList.remove("pw-window-managed-tab");
        this.managedTabs.clear();
        this.restoreSettings();
        this.vaultHeader?.dispose();
        this.toolbar?.remove();
        this.titleToolbar?.remove();
        this.leftToggle?.remove();
        this.doc?.body.classList.remove("pw-window-actions-enabled");
        if (!this.doc) return;
        if (this.previousHeaderHeight) this.doc.body.style.setProperty("--pw-document-header-height", this.previousHeaderHeight);
        else this.doc.body.style.removeProperty("--pw-document-header-height");
        if (this.previousRightSpace) this.doc.body.style.setProperty("--pw-window-tools-right-space", this.previousRightSpace, this.previousRightPriority);
        else this.doc.body.style.removeProperty("--pw-window-tools-right-space");
    }
}

export { WindowActions };
