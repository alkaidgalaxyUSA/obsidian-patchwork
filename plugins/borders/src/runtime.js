import { ModuleUnavailableError } from "../../utils/module-errors";
import { getWindowContext } from "../../utils/windows";
import { scopeModule } from "../../utils/module-scope";
import { createNativePanel } from "../../utils/native-panel";
import { NativeWorkspace } from "./utils/native-workspace";
import { WindowActions } from "./top/window-actions";
import { TooltipDelays } from "./top/tooltip-delays";
import { AppFocus } from "./top/app-focus";
import { TabActionsPosition } from "./top/tab-actions-position";
import { SettingsHost } from "./top/settings-host";
import { LeftActions } from "./left/left-actions";
import { RightActions } from "./right/right-actions";
import { SidebarResize } from "./right/sidebar-resize";
import { PanelHost } from "./bottom/panel-host";
import { DocumentStatusBar } from "./bottom/document-status-bar";
import { BackgroundProgress } from "./bottom/background-progress";
import { BackgroundProgressView } from "./bottom/background-progress-view";
import { installAboutTab } from "./top/about-tab";
import { installSettingsLifecycle } from "./top/settings-lifecycle";

/** Registration/lifetime coordinator. Each edge owns its presentation. */
export class BordersRuntime {
    constructor(plugin, store) {
        this.plugin = plugin; this.app = plugin.app;
        this.store = store;
        this.native = new NativeWorkspace(this.app);
        this.managedTabs = new Map();
        this.managedHeaders = new Map();
        this.panels = new Map(); this.headers = new Map(); this.tabs = new Map(); this.windows = new Map();
        this.listeners = new Set(); this.queues = new Map();
        this.settings = new SettingsHost(this.app);
        this.progress = new BackgroundProgress();
        this.appFocus = new AppFocus(this.app.workspace.containerEl.ownerDocument.defaultView);
        plugin.register(() => this.appFocus.dispose());
        installAboutTab(plugin); installSettingsLifecycle(plugin);
        for (const event of ["layout-change", "active-leaf-change", "file-open", "window-open"]) {
            plugin.registerEvent(this.app.workspace.on(event, () => this.schedule()));
        }
        this.app.workspace.onLayoutReady(() => this.schedule());
    }

    schedule() {
        if (this.disposed || this.scheduled) return;
        this.scheduled = true;
        this.frame = this.app.workspace.containerEl.ownerDocument.defaultView.requestAnimationFrame(() => {
            this.scheduled = false; this.frame = undefined;
            if (!this.disposed) this.sync();
        });
    }

    sync() {
        if (this.disposed || !this.app.workspace.layoutReady) return;
        this.syncBookmarks();
        const docs = new Set([this.app.workspace.containerEl.ownerDocument]);
        this.app.workspace.iterateAllLeaves(leaf => docs.add(leaf.view.containerEl.ownerDocument));
        for (const [id, shell] of this.windows) {
            if (!docs.has(shell.context.document) || shell.context.document.defaultView?.closed) this.removeWindow(id);
        }
        for (const doc of docs) {
            if (!doc.defaultView || doc.defaultView.closed) continue;
            const context = getWindowContext(doc);
            let shell = this.windows.get(context.windowId);
            if (!shell) {
                shell = { context, top: new WindowActions(this.app, doc), footer: new DocumentStatusBar(this.plugin, doc), states: new Map(), cleanups: [],
                    originalEnabled: doc.body.classList.contains("pw-window-actions-enabled") };
                this.windows.set(context.windowId, shell);
                if (shell.footer.bar) {
                    this.progress.addWindow(context);
                    shell.progress = new BackgroundProgressView(shell.footer.bar, context, this.progress);
                }
                shell.cleanups.push(this.appFocus.add(doc));
                const tooltipDelays = new TooltipDelays(doc);
                shell.cleanups.push(() => tooltipDelays.dispose());
                doc.body.classList.add("pw-window-actions-enabled"); doc.body.dataset.pwBordersEnabled = "true";
                const interact = event => { shell.focused = this.resolveFocus(shell, event.target); this.updateStates(shell); };
                const resize = () => this.schedule();
                const closed = () => this.removeWindow(context.windowId);
                doc.addEventListener("pointerdown", interact, true); doc.addEventListener("focusin", interact, true);
                doc.defaultView.addEventListener("resize", resize); doc.defaultView.addEventListener("blur", resize); doc.defaultView.addEventListener("focus", resize);
                doc.defaultView.addEventListener("unload", closed, { once: true });
                shell.cleanups.push(() => {
                    doc.removeEventListener("pointerdown", interact, true); doc.removeEventListener("focusin", interact, true);
                    for (const event of ["resize", "blur", "focus"]) doc.defaultView?.removeEventListener(event, resize);
                    doc.defaultView?.removeEventListener("unload", closed);
                });
            }
            const workspace = this.app.workspace;
            if (doc === workspace.containerEl.ownerDocument && workspace.leftRibbon?.containerEl && workspace.rightRibbon?.containerEl && !shell.left) {
                shell.left = new LeftActions(workspace.leftRibbon.containerEl, context, (id, options) => this.togglePanel(id, options), () => workspace.leftRibbon?.items ?? []);
                shell.right = new RightActions(workspace.rightRibbon.containerEl, this.native, context, (id, options) => this.togglePanel(id, options));
                shell.bottom = new PanelHost(workspace.containerEl, () => this.resizeInstances(shell));
                shell.preview = new SidebarResize(this.app, this.native, context, () => this.activeRight(shell));
                shell.observer = new doc.defaultView.MutationObserver(() => this.schedule());
                for (const dock of [workspace.leftSplit, workspace.rightSplit]) {
                    if (dock?.containerEl) shell.observer.observe(dock.containerEl, { subtree: true, attributes: true, attributeFilter: ["class", "style"], childList: true });
                }
            }
            shell.top.sync();
            for (const [id, contribution] of this.headers) if (!shell.top.slots.has(id)) {
                try { shell.top.mount(id, contribution, context); } catch (error) { console.error("Patchwork header contribution failed.", error); }
            }
            for (const [id, registration] of this.tabs) {
                if (registration.contribution.context.windowId === context.windowId && !shell.top.leases.has(id)) {
                    shell.top.leases.set(id, new TabActionsPosition(registration.contribution));
                }
            }
            this.updateStates(shell);
        }
        this.settings.sync();
        this.syncManagedTabs();
        if (!this.migrationStarted && [...this.windows.values()].some(shell => shell.left)) {
            this.migrationStarted = true;
            void this.store.migrate().then(() => {
                if (this.disposed) return;
                const project = this.panels.get("project")?.definition;
                const context = getWindowContext(this.app.workspace.containerEl.ownerDocument);
                if (project && this.store.projectCollapsed === true && this.native.leaves(project, context).some(leaf => leaf.tabHeaderEl?.classList.contains("is-active"))) {
                    this.native.hide("left", context);
                }
                this.schedule();
            }).catch(error => { this.migrationStarted = false; console.error("Could not migrate Borders settings; donor data was retained.", error); });
        }
    }

    syncBookmarks() {
        const available = this.app.internalPlugins?.plugins?.bookmarks?.enabled;
        if (!available) { this.bookmarks?.dispose(); this.bookmarks = undefined; return; }
        if (this.bookmarks) return;
        this.bookmarks = this.registerPanel({
            id: "bookmarks", owner: "borders", label: "Bookmarks", icon: "idea/expui/toolwindows/bookmarks_dark.svg",
            dock: "left", rail: "left", railGroup: "main", order: 30,
            host: { kind: "native-leaf", viewType: "bookmarks" },
            create: (host, context) => createNativePanel(this.app, host, context),
        });
    }

    registerPanel(definition) {
        if (this.disposed || this.panels.has(definition.id)) throw new Error(`Panel already registered or host disposed: ${definition.id}`);
        const record = { definition, instances: new Map() };
        this.panels.set(definition.id, record); this.schedule();
        return { dispose: () => {
            if (this.panels.get(definition.id) !== record) return;
            this.panels.delete(definition.id);
            for (const [windowId, instance] of record.instances) {
                const shell = this.windows.get(windowId);
                if (definition.dock === "bottom" && instance.visible) shell?.bottom?.hide();
                this.disposeInstance(instance);
                this.emit({ id: definition.id, windowId, visible: false, focused: false });
            }
            record.instances.clear(); this.schedule();
        } };
    }

    startProgress(options) {
        this.sync();
        return this.progress.start(options);
    }

    syncManagedTabs() {
        const current = new Set();
        const headers = new Set();
        for (const shell of this.windows.values()) {
            if (!shell.left) continue;
            for (const { definition } of this.panels.values()) {
                if (definition.dock === "left" && definition.host.kind === "native-leaf") {
                    for (const leaf of this.native.leaves(definition, shell.context)) {
                        const header = leaf.tabHeaderEl?.closest(".workspace-tab-header-container");
                        if (header) headers.add(header);
                    }
                }
                if (definition.dock !== "right" || definition.host.kind !== "native-leaf") continue;
                for (const leaf of this.native.leaves(definition, shell.context)) if (leaf.tabHeaderEl) current.add(leaf.tabHeaderEl);
            }
        }
        for (const [tab, hadClass] of this.managedTabs) if (!current.has(tab)) {
            if (!hadClass) tab.classList.remove("pw-window-managed-tab");
            this.managedTabs.delete(tab);
        }
        for (const tab of current) if (!this.managedTabs.has(tab)) {
            this.managedTabs.set(tab, tab.classList.contains("pw-window-managed-tab"));
            tab.classList.add("pw-window-managed-tab");
        }
        for (const [header, hadClass] of this.managedHeaders) if (!headers.has(header)) {
            if (!hadClass) header.classList.remove("pw-panel-managed-header");
            this.managedHeaders.delete(header);
        }
        for (const header of headers) if (!this.managedHeaders.has(header)) {
            this.managedHeaders.set(header, header.classList.contains("pw-panel-managed-header"));
            header.classList.add("pw-panel-managed-header");
        }
    }

    registerHeader(contribution) {
        if (this.headers.has(contribution.id)) throw new Error(`Header already registered: ${contribution.id}`);
        this.headers.set(contribution.id, contribution); this.schedule();
        return { dispose: () => {
            if (this.headers.get(contribution.id) !== contribution) return;
            this.headers.delete(contribution.id);
            for (const shell of this.windows.values()) shell.top.unmount(contribution.id);
        } };
    }

    registerSettings(contribution) {
        if (this.settings.contributions.has(contribution.id)) throw new Error(`Settings already registered: ${contribution.id}`);
        this.settings.add(contribution);
        return { dispose: () => { if (this.settings.contributions.get(contribution.id) === contribution) this.settings.remove(contribution.id); } };
    }

    registerTabActions(contribution) {
        if (this.tabs.has(contribution.id)) throw new Error(`Tab controls already leased: ${contribution.id}`);
        if (contribution.container.ownerDocument !== contribution.context.document || contribution.controls.some(control => control.ownerDocument !== contribution.context.document)) {
            throw new Error("Tab control leases must belong to the requested window.");
        }
        const registration = { contribution };
        this.tabs.set(contribution.id, registration); this.schedule();
        return { dispose: () => {
            if (this.tabs.get(contribution.id) !== registration) return;
            this.tabs.delete(contribution.id);
            const shell = this.windows.get(contribution.context.windowId);
            shell?.top.leases.get(contribution.id)?.dispose(); shell?.top.leases.delete(contribution.id);
        } };
    }

    shell(context) {
        this.native.window(context); this.sync();
        const shell = this.windows.get(context.windowId);
        if (!shell?.left) throw new ModuleUnavailableError("borders", "The workspace panel hosts are not ready.");
        return shell;
    }

    async queue(id, options, operation) {
        options.context.signal?.throwIfAborted();
        const record = this.panels.get(id);
        if (!record || this.disposed) return Promise.reject(new ModuleUnavailableError(id, "The requested panel provider is unavailable."));
        const key = `${options.context.windowId}:${record.definition.dock}`;
        const pending = (this.queues.get(key) ?? Promise.resolve()).then(() => {
            if (this.disposed || this.panels.get(id) !== record) throw new ModuleUnavailableError(id, "The panel provider was disabled.");
            return operation(record);
        });
        const settled = pending.catch(() => {}); this.queues.set(key, settled);
        void settled.then(() => { if (this.queues.get(key) === settled) this.queues.delete(key); });
        return pending;
    }

    async instance(record, shell, options) {
        const { definition } = record;
        let instance = record.instances.get(shell.context.windowId);
        if (instance && !instance.host.isConnected) { this.disposeInstance(instance); record.instances.delete(shell.context.windowId); instance = undefined; }
        if (instance) return instance;
        const leaf = definition.host.kind === "native-leaf" ? await this.native.resolveLeaf(definition, options.context) : undefined;
        const owned = leaf ? undefined : shell.bottom.create(definition.owner);
        const host = leaf ? (leaf.view.contentEl ?? leaf.view.containerEl) : owned.host;
        if (!host) throw new ModuleUnavailableError(definition.id, "The native view has no content host.");
        const scope = leaf ? scopeModule(host, definition.owner) : undefined;
        let panel;
        try {
            panel = await definition.create(host, shell.context);
            if (this.disposed || this.panels.get(definition.id) !== record || !this.windows.has(shell.context.windowId) || options.context.signal?.aborted) {
                panel.dispose(); options.context.signal?.throwIfAborted();
                throw new ModuleUnavailableError(definition.id, "The panel provider or window was closed while opening.");
            }
        } catch (error) { scope?.dispose(); owned?.dispose(); throw error; }
        instance = { panel, host, leaf, owned, scope, visible: false };
        record.instances.set(shell.context.windowId, instance);
        return instance;
    }

    openPanel(id, options) { return this.queue(id, options, record => this.open(record, options)); }
    togglePanel(id, options) {
        return this.queue(id, options, async record => {
            const shell = this.shell(options.context); this.updateStates(shell);
            if (shell.states.get(id)?.visible) this.hidePanel(id, options.context);
            else await this.open(record, options);
        });
    }

    async open(record, options) {
        const shell = this.shell(options.context), { definition } = record;
        const instance = await this.instance(record, shell, options);
        options.context.signal?.throwIfAborted();
        if (this.disposed || this.panels.get(definition.id) !== record || this.windows.get(shell.context.windowId) !== shell) {
            throw new ModuleUnavailableError(definition.id, "The panel provider or window was closed.");
        }
        for (const other of this.panels.values()) {
            if (other === record || other.definition.dock !== definition.dock) continue;
            const sibling = other.instances.get(shell.context.windowId);
            if (sibling?.visible) { this.hideInstance(sibling); if (sibling.owned) sibling.host.hidden = true; }
        }
        const previous = instance.leaf ? this.native.capture(definition.dock, options.context) : undefined;
        try {
            if (instance.leaf) await this.native.show(definition, options.context, instance.leaf);
            else shell.bottom.show(instance.host);
            options.context.signal?.throwIfAborted();
            if (this.disposed || this.panels.get(definition.id) !== record || this.windows.get(shell.context.windowId) !== shell) {
                throw new ModuleUnavailableError(definition.id, "The panel provider or window was closed.");
            }
            await instance.panel.show(options);
            options.context.signal?.throwIfAborted();
            if (this.disposed || this.panels.get(definition.id) !== record) throw new ModuleUnavailableError(definition.id, "The panel provider was disabled.");
            instance.visible = true;
            if (options.focus !== false) { instance.panel.focus(); shell.focused = definition.id; }
            this.resizeInstances(shell); this.updateStates(shell);
        } catch (error) {
            if (instance.owned) { instance.host.hidden = true; shell.bottom.hide(); }
            if (previous && !this.disposed && this.windows.get(shell.context.windowId) === shell) {
                try { await this.native.restore(definition.dock, shell.context, previous); }
                catch (restoreError) { console.error("Could not restore the previous native panel.", restoreError); }
            }
            instance.visible = false; this.updateStates(shell); throw error;
        }
    }

    hidePanel(id, context) {
        const record = this.panels.get(id), shell = this.windows.get(context.windowId);
        if (!record || !shell) return;
        this.native.window(context);
        const instance = record.instances.get(context.windowId);
        if (instance) this.hideInstance(instance);
        if (record.definition.dock === "bottom") { if (shell.states.get(id)?.visible) shell.bottom?.hide(); if (instance) instance.host.hidden = true; }
        else if (this.native.leaves(record.definition, context).some(leaf => this.native.visible(leaf, this.native.dock(record.definition.dock, context)))) this.native.hide(record.definition.dock, context);
        this.updateStates(shell);
    }

    getPanelState(id, context) {
        const shell = this.windows.get(context.windowId);
        if (!shell || shell.context.document !== context.document || !this.panels.has(id)) return undefined;
        this.updateStates(shell); return shell.states.get(id);
    }

    onPanelState(listener) {
        this.listeners.add(listener);
        for (const shell of this.windows.values()) for (const state of shell.states.values()) this.deliver(listener, state);
        return () => this.listeners.delete(listener);
    }
    deliver(listener, state) { try { listener({ ...state }); } catch (error) { console.error("Patchwork panel subscriber failed.", error); } }
    emit(state) { for (const listener of [...this.listeners]) this.deliver(listener, state); }

    resolveFocus(shell, target) {
        for (const [id, record] of this.panels) {
            if (shell.left?.buttons.get(id)?.contains(target) || shell.right?.buttons.get(id)?.contains(target)) return id;
            const instance = record.instances.get(shell.context.windowId);
            if (instance?.host.contains(target)) return id;
            if (record.definition.host.kind === "native-leaf" && shell.left && this.native.leaves(record.definition, shell.context).some(leaf => leaf.view.containerEl.contains(target))) return id;
        }
    }

    activeRight(shell) {
        const definitions = [...this.panels.values()].map(record => record.definition).filter(definition => definition.dock === "right");
        return definitions.find(definition => shell.states.get(definition.id)?.visible)
            ?? definitions.find(definition => this.native.leaves(definition, shell.context).some(leaf => leaf.tabHeaderEl?.classList.contains("is-active")));
    }

    updateStates(shell) {
        if (!shell.left || this.disposed) return;
        for (const [id, record] of this.panels) {
            const instance = record.instances.get(shell.context.windowId), definition = record.definition;
            const visible = definition.host.kind === "native-leaf" ? this.native.leaves(definition, shell.context).some(leaf => this.native.visible(leaf, this.native.dock(definition.dock, shell.context)))
                : !!instance?.visible && !shell.bottom.el.hidden;
            const state = { id, windowId: shell.context.windowId, visible, focused: visible && shell.focused === id && shell.context.document.hasFocus() };
            if (instance) instance.visible = visible;
            const previous = shell.states.get(id); shell.states.set(id, state);
            if (!previous || previous.visible !== visible || previous.focused !== state.focused) this.emit(state);
        }
        for (const id of shell.states.keys()) if (!this.panels.has(id)) shell.states.delete(id);
        const definitions = [...this.panels.values()].map(record => record.definition);
        shell.left.sync(definitions.filter(definition => definition.rail === "left"), shell.states);
        const right = this.activeRight(shell);
        shell.right.sync(definitions.filter(definition => definition.rail === "right"), shell.states, right);
        this.native.setBounds("right", shell.context, right?.bounds);
        const project = this.panels.get("project")?.definition;
        if (this.store.migrated && project && this.native.leaves(project, shell.context).some(leaf => leaf.tabHeaderEl?.classList.contains("is-active"))) {
            this.store.saveProjectCollapsed(this.native.dock("left", shell.context).collapsed);
        }
    }

    resizeInstances(shell) {
        for (const record of this.panels.values()) {
            const instance = record.instances.get(shell.context.windowId);
            if (instance?.visible) {
                try { instance.panel.resize(instance.host.getBoundingClientRect()); }
                catch (error) { console.error("Patchwork panel resize failed.", error); }
            }
        }
    }

    hideInstance(instance) {
        try { instance.panel.hide(); }
        catch (error) { console.error("Patchwork panel hide failed.", error); }
        instance.visible = false;
    }
    disposeInstance(instance) {
        try { instance.panel.dispose(); }
        catch (error) { console.error("Patchwork panel cleanup failed.", error); }
        finally { instance.scope?.dispose(); instance.owned?.dispose(); }
    }
    removeWindow(id) {
        const shell = this.windows.get(id); if (!shell) return;
        this.windows.delete(id);
        shell.progress?.dispose(); this.progress.removeWindow(id);
        for (const [tab, hadClass] of this.managedTabs) if (tab.ownerDocument === shell.context.document) {
            if (!hadClass) tab.classList.remove("pw-window-managed-tab"); this.managedTabs.delete(tab);
        }
        for (const [header, hadClass] of this.managedHeaders) if (header.ownerDocument === shell.context.document) {
            if (!hadClass) header.classList.remove("pw-panel-managed-header"); this.managedHeaders.delete(header);
        }
        for (const [tabId, registration] of this.tabs) if (registration.contribution.context.windowId === id) this.tabs.delete(tabId);
        for (const state of shell.states.values()) this.emit({ ...state, visible: false, focused: false });
        if (shell.left) for (const dock of [this.app.workspace.leftSplit, this.app.workspace.rightSplit]) this.native.restoreBounds(dock);
        for (const record of this.panels.values()) {
            const instance = record.instances.get(id); if (instance) this.disposeInstance(instance); record.instances.delete(id);
        }
        shell.preview?.dispose(); shell.observer?.disconnect();
        shell.top.dispose(); shell.footer.dispose(); shell.left?.dispose(); shell.right?.dispose(); shell.bottom?.dispose();
        for (const remove of shell.cleanups) remove();
        if (!shell.originalEnabled) shell.context.document.body.classList.remove("pw-window-actions-enabled");
        delete shell.context.document.body.dataset.pwBordersEnabled;
    }

    dispose() {
        this.disposed = true;
        if (this.frame !== undefined) this.app.workspace.containerEl.ownerDocument.defaultView.cancelAnimationFrame(this.frame);
        for (const id of this.windows.keys()) this.removeWindow(id);
        this.native.dispose(); this.settings.dispose(); this.listeners.clear(); this.headers.clear(); this.tabs.clear(); this.panels.clear();
        this.progress.dispose();
    }
}
