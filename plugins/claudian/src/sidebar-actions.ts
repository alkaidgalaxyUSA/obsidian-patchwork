import type { App, WorkspaceLeaf } from "obsidian";
import type { SidebarDock, SidebarEntry } from "./types";
const TOOLBAR_CLASS = "claudian-extension-top-toolbar";
const NAV_CLASS = "claudian-extension-nav-relocated";

export class SidebarActions {
    private entries = new Map<WorkspaceLeaf, SidebarEntry>();
    private disposed = false;

    constructor(private readonly app: App) {}

    sync() {
        if (this.disposed) return;
        const dock = this.app.workspace.rightSplit as SidebarDock;
        const dockEl = dock?.containerEl;
        const leaves = this.app.workspace.getLeavesOfType("claudian-view")
            .filter((leaf) => dockEl?.contains(leaf.view.containerEl));
        const current = new Set<WorkspaceLeaf>();
        let visible = false;
        for (const leaf of leaves) {
            const view = leaf.view.containerEl;
            const panel = view.querySelector<HTMLElement>(".claudian-container > .claudian-chat-panel");
            const actions = view.querySelector<HTMLElement>(".claudian-input-nav-actions");
            if (!panel || !actions) continue;
            const previous = this.entries.get(leaf);
            if (previous && (previous.panel !== panel || previous.actions !== actions
                || !previous.marker.isConnected || previous.toolbar.parentElement !== panel
                || actions.parentElement !== previous.toolbar)) {
                this.detach(leaf);
            }
            const entry = this.entries.get(leaf) ?? this.attach(leaf, panel, actions);
            if (!entry) continue;
            current.add(leaf);
            const bounds = panel.getBoundingClientRect();
            if (bounds.width > 0 && bounds.height > 0) visible = true;
            const menuHeight = `${Math.max(0, bounds.height - 40)}px`;
            if (entry.menuHeight !== menuHeight) {
                entry.toolbar.style.setProperty("--claudian-extension-menu-height", menuHeight);
                entry.menuHeight = menuHeight;
            }
        }
        for (const leaf of this.entries.keys()) {
            if (!current.has(leaf)) this.detach(leaf);
        }
    }

    attach(leaf: WorkspaceLeaf, panel: HTMLElement, actions: HTMLElement): SidebarEntry | undefined {
        const nav = actions.closest<HTMLElement>(".claudian-view-input-nav-row");
        if (!nav || !actions.querySelector<HTMLElement>(".claudian-new-tab-btn")
            || !actions.querySelector<HTMLElement>(".claudian-new-conversation-btn")
            || !actions.querySelector<HTMLElement>(".claudian-history-container")) return undefined;
        const doc = panel.ownerDocument;
        const marker = doc.createComment("claudian-extension-navigation-position");
        const toolbar = doc.createElement("div");
        toolbar.className = TOOLBAR_CLASS;
        toolbar.setAttribute("role", "group");
        toolbar.setAttribute("aria-label", "Conversation actions");
        actions.before(marker);
        // Move the original controls, including the history menu and its listeners.
        toolbar.append(actions);
        panel.prepend(toolbar);
        nav.classList.add(NAV_CLASS);
        const entry = { panel, actions, nav, marker, toolbar };
        this.entries.set(leaf, entry);
        return entry;
    }

    detach(leaf: WorkspaceLeaf) {
        const entry = this.entries.get(leaf);
        if (!entry) return;
        this.entries.delete(leaf);
        // Do not pull controls back if Claudian has already moved them elsewhere.
        if (entry.actions.parentElement === entry.toolbar && entry.marker.parentNode) {
            entry.marker.replaceWith(entry.actions);
        } else {
            entry.marker.remove();
        }
        entry.toolbar.remove();
        entry.nav.classList.remove(NAV_CLASS);
    }

    dispose() {
        this.disposed = true;
        for (const leaf of this.entries.keys()) this.detach(leaf);
    }
}

