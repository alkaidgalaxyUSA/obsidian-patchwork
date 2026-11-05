import { ToolTabs } from "../../../utils/tool-tabs";
import { GitLogPane } from "./git-log-pane";
import { setIcon } from "../utils/icons";
import { getWindowContext } from "../../../utils/windows";

export class GitTool {
    constructor(controller, host, hide) {
        this.controller = controller;
        let containerId;
        controller.app.workspace.iterateAllLeaves(leaf => {
            const container = leaf.getContainer();
            if (container.doc === host.ownerDocument && typeof container.id === "string") containerId = container.id;
        });
        this.windowSuffix = host.ownerDocument === controller.app.workspace.containerEl.ownerDocument ? "" : `::${containerId || getWindowContext(host.ownerDocument).windowId}`;
        this.tabs = new ToolTabs(host, "git", "Git", () => this.add(), hide);
        setIcon(this.tabs.actions.querySelector("button"), "git-header-hide");
        controller.logTools.set(host.ownerDocument, this);
        this.persistAfterInteraction = () => queueMicrotask(() => { if (!this.disposed) this.persist(); });
        host.addEventListener("click", this.persistAfterInteraction);
        host.addEventListener("keydown", this.persistAfterInteraction);
        this.navigateTabs = event => {
            const element = event.target.closest(".pw-tool-tab");
            const index = this.tabs.tabs.findIndex(tab => tab.el === element);
            if (index < 0) return;
            if (event.key === "Delete") { event.preventDefault(); this.tabs.remove(this.tabs.tabs[index]); this.tabs.active?.el.focus(); return; }
            const target = { ArrowLeft: index - 1, ArrowRight: index + 1, Home: 0, End: this.tabs.tabs.length - 1 }[event.key];
            if (target === undefined) return;
            event.preventDefault(); const tab = this.tabs.tabs[(target + this.tabs.tabs.length) % this.tabs.tabs.length];
            this.tabs.select(tab); tab.el.focus();
        };
        host.addEventListener("keydown", this.navigateTabs);
    }

    add(filter) {
        this.restored = true;
        let tab;
        const pane = new GitLogPane(this.controller, this.tabs.body, label => {
            if (!tab) return;
            tab.label = label; tab.title.setText(label); this.persist();
        }, filter);
        tab = this.tabs.append("Log", pane);
        const id = `pw-git-tab-${crypto.randomUUID()}`;
        tab.el.id = id; pane.el.id = `${id}-panel`;
        tab.el.setAttribute("aria-controls", pane.el.id);
        pane.el.setAttribute("role", "tabpanel"); pane.el.setAttribute("aria-labelledby", id);
        setIcon(tab.el.querySelector("button"), "git-log-close");
        return pane;
    }

    show() {
        if (this.tabs.tabs.length) { void this.tabs.active.pane.refresh(); return; }
        const saved = !this.restored && this.controller.plugin.settingsStore.preferences.logTabs?.[this.controller.repository.root + this.windowSuffix];
        if (Array.isArray(saved?.filters) && saved.filters.length) {
            this.restoring = true;
            for (const filter of saved.filters) this.add(filter);
            this.tabs.select(this.tabs.tabs[Math.max(0, Math.min(this.tabs.tabs.length - 1, Number(saved.active) || 0))]);
            this.restoring = false;
        } else this.add();
    }
    persist() {
        for (const tab of this.tabs.tabs) tab.el.tabIndex = tab === this.tabs.active ? 0 : -1;
        if (!this.restored || this.restoring || this.disposed) return;
        const state = { filters: this.tabs.tabs.map(tab => ({ ...tab.pane.filter })), active: this.tabs.tabs.indexOf(this.tabs.active) };
        const signature = JSON.stringify(state), root = this.controller.repository.root + this.windowSuffix;
        if (signature === this.savedSignature && root === this.savedRoot) return;
        this.savedSignature = signature; this.savedRoot = root;
        const store = this.controller.plugin.settingsStore;
        void store.savePreferences({ logTabs: { ...(store.preferences.logTabs || {}), [root]: state } }).catch(error => console.error("Could not persist Git Log tabs.", error));
    }
    async openHistory(paths) { const pane = this.add(); await pane.setHistoryPaths(paths); return pane; }
    dispose() {
        this.persist(); this.disposed = true;
        this.tabs.host.removeEventListener("click", this.persistAfterInteraction);
        this.tabs.host.removeEventListener("keydown", this.persistAfterInteraction);
        this.tabs.host.removeEventListener("keydown", this.navigateTabs);
        if (this.controller.logTools.get(this.tabs.host.ownerDocument) === this) this.controller.logTools.delete(this.tabs.host.ownerDocument);
        this.tabs.dispose();
    }
}
