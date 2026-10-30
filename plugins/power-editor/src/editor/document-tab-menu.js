import { Menu, Notice, TFile } from "obsidian";
import { DocumentHistory } from "./document-history";
import { DocumentPicker } from "./document-picker";
import { activateDocumentTab } from "./document-tabs";

/** Document group actions shown by the tab strip's three-dot button. */
export class DocumentTabMenu {
    constructor(plugin) {
        this.app = plugin.app;
        this.history = new DocumentHistory(plugin);
        this.dialogs = new Set();
        this.closing = new Set();
        plugin.documentTabMenu = this;
        plugin.register(() => {
            this.disposed = true;
            this.menu?.hide();
            for (const dialog of this.dialogs) dialog.close();
            if (plugin.documentTabMenu === this) delete plugin.documentTabMenu;
        });
    }

    close(tabs) { if (this.tabs === tabs) this.menu?.hide(); }

    show(tabs, anchor) {
        if (this.menu?.dom.isConnected && this.tabs === tabs) { this.menu.hide(); return; }
        this.menu?.hide();
        this.history.record(this.app.workspace.activeLeaf);
        const menu = this.menu = new Menu();
        this.tabs = tabs;
        menu.dom.classList.add("pw-document-options-menu");
        menu.setParentElement(anchor);
        const add = (title, action, disabled = false) => menu.addItem(item => item.setTitle(title).setDisabled(disabled)
            .onClick(() => { void Promise.resolve().then(action).catch(error => new Notice(error.message)); }));
        add("Recent Files", () => this.recentFiles(tabs));
        add("Recent Locations", () => this.recentLocations(tabs));
        add("Go to File...", () => this.goToFile(tabs));
        menu.addSeparator();
        const canClose = tabs.children.some(leaf => !leaf.pinned) && !this.closing.has(tabs);
        add("Close All Tabs", () => this.closeTabs(tabs), !canClose);
        add("Close Unmodified Tabs", () => this.closeTabs(tabs, true), !canClose);
        menu.addSeparator();
        add("Bookmark Open Tabs...", () => this.bookmark(tabs), !tabs.children.some(leaf => leaf.view.file));
        menu.addSeparator();
        add("Configure Editor Tabs...", () => {
            this.app.setting.open();
            this.app.setting.openTabById("editor");
        });
        anchor.setAttribute("aria-expanded", "true");
        menu.onHide(() => {
            anchor.setAttribute("aria-expanded", "false");
            if (this.menu === menu) this.menu = undefined;
        });
        const bounds = anchor.getBoundingClientRect();
        menu.showAtPosition({ x: Math.max(8, bounds.right - 220), y: bounds.bottom + 4 });
    }

    picker(title, items, tabs) {
        if (!items.length) { new Notice("No matching documents are available."); return; }
        const dialog = new DocumentPicker(this.app, title, items, item => this.open(item, tabs));
        const close = dialog.onClose.bind(dialog);
        dialog.onClose = () => { this.dialogs.delete(dialog); close(); };
        this.dialogs.add(dialog);
        dialog.open();
    }

    recentFiles(tabs) {
        const paths = [...new Set([...this.history.locations.map(item => item.path), ...this.app.workspace.getLastOpenFiles()])];
        const files = paths.map(path => this.app.vault.getAbstractFileByPath(path)).filter(file => file instanceof TFile);
        this.picker("Recent Files", files.map(file => ({ path: file.path, label: file.name })), tabs);
    }

    recentLocations(tabs) {
        const items = this.history.locations.filter(item => this.app.vault.getAbstractFileByPath(item.path) instanceof TFile);
        this.picker("Recent Locations", items, tabs);
    }

    goToFile(tabs) {
        this.picker("Go to File", this.app.vault.getFiles().map(file => ({ path: file.path, label: file.name })), tabs);
    }

    async open(item, tabs) {
        const file = this.app.vault.getAbstractFileByPath(item.path);
        if (!(file instanceof TFile)) throw new Error("This file is no longer available.");
        let leaf = tabs.children.find(candidate => candidate.view.file === file);
        if (!leaf) {
            const selected = tabs.children[tabs.currentTab];
            if (selected && this.app.workspace.isAttached(selected)) this.app.workspace.setActiveLeaf(selected, { focus: false });
            leaf = this.app.workspace.getLeaf("tab");
            await leaf.openFile(file);
        }
        await leaf.loadIfDeferred();
        if (item.state) await leaf.setViewState({ ...item.state, active: true });
        if (item.state?.state.mode && leaf.view.getMode?.() !== item.state.state.mode && leaf.view.setState) {
            await leaf.view.setState({ ...leaf.view.getState(), mode: item.state.state.mode }, { history: false });
        }
        await activateDocumentTab(this.app, leaf);
        if (item.ephemeral) leaf.setEphemeralState(item.ephemeral);
        const code = leaf.view.editorView;
        if (code && Number.isInteger(item.codeOffset)) {
            code.dispatch({ selection: { anchor: Math.min(item.codeOffset, code.state.doc.length) }, scrollIntoView: true });
            if (Number.isFinite(item.codeScrollTop)) code.scrollDOM.scrollTop = item.codeScrollTop;
        }
        this.history.record(leaf);
    }

    dirty(leaf) {
        const view = leaf.view;
        if (view.dirty || view.saveAgain) return true;
        return typeof view.getViewData === "function" && typeof view.lastSavedData === "string"
            && view.getViewData() !== view.lastSavedData;
    }

    async closeTabs(tabs, unmodified = false) {
        if (this.closing.has(tabs)) return;
        this.closing.add(tabs);
        try {
            const initialViews = new Map(tabs.children.map(leaf => [leaf, { view: leaf.view, file: leaf.view.file, data: leaf.view.lastSavedData }]));
            const git = this.app.plugins.plugins["patchwork-git"];
            let changed;
            if (unmodified && git) {
                if (!git.gitReady || git.controller.busy) throw new Error("Wait until Git is ready before closing unmodified tabs.");
                changed = new Set((await git.repository.status()).flatMap(entry => [entry.path, entry.original].filter(Boolean)));
            }
            for (const leaf of [...tabs.children]) {
                if (this.disposed) return;
                if (leaf.pinned || leaf.parent !== tabs) continue;
                const initial = initialViews.get(leaf);
                if (!initial || initial.view !== leaf.view || initial.file !== leaf.view.file) continue;
                if (unmodified && this.dirty(leaf)) continue;
                if (unmodified && leaf.view.lastSavedData !== initial.data) continue;
                if (unmodified && leaf.view.file && changed?.has(git.repository.path(leaf.view.file.path))) continue;
                try {
                    await leaf.view.save?.();
                    if (leaf.parent === tabs && !leaf.pinned) leaf.detach();
                } catch { new Notice("A tab could not be saved and was left open."); }
            }
        } finally { this.closing.delete(tabs); }
    }

    async bookmark(tabs) {
        const core = this.app.internalPlugins.plugins.bookmarks;
        if (!core) throw new Error("The Bookmarks core plugin is unavailable.");
        if (!core.enabled) await core.enable(true);
        if (!core.enabled || !core.instance.onTabGroupMenu) throw new Error("Could not open Bookmarks.");
        const menu = new Menu();
        core.instance.onTabGroupMenu(menu, tabs);
        const action = menu.items.find(item => typeof item.callback === "function");
        if (!action) throw new Error("There are no document tabs to bookmark.");
        action.callback();
    }
}
