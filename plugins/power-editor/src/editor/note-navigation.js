class NoteNavigation {
    constructor(plugin) {
        this.app = plugin.app;
        this.documents = new Map();
        for (const event of ["layout-change", "active-leaf-change", "file-open"]) {
            plugin.registerEvent(this.app.workspace.on(event, () => this.schedule()));
        }
        plugin.registerEvent(this.app.workspace.on("window-open", () => this.schedule()));
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

    findLeaf(doc) {
        const active = this.app.workspace.activeLeaf;
        if (active?.view.containerEl.ownerDocument === doc && active.view.containerEl.closest(".mod-root")) {
            return active.view.file ? active : undefined;
        }
        const leaves = [];
        this.app.workspace.iterateAllLeaves((leaf) => leaves.push(leaf));
        return leaves
            .filter((leaf) => leaf.view.file && leaf.view.containerEl.ownerDocument === doc
                && leaf.view.containerEl.closest(".mod-root") && leaf.view.containerEl.getClientRects().length)
            .sort((left, right) => (right.activeTime || 0) - (left.activeTime || 0))[0];
    }

    refresh() {
        const documents = new Set([this.app.workspace.containerEl.ownerDocument]);
        this.app.workspace.iterateAllLeaves((leaf) => documents.add(leaf.view.containerEl.ownerDocument));
        for (const [doc, entry] of this.documents) {
            if (documents.has(doc) && !doc.defaultView.closed) continue;
            this.detach(doc, entry);
            this.documents.delete(doc);
        }
        for (const doc of documents) {
            if (doc.defaultView.closed) continue;
            const entry = this.documents.get(doc) || this.attach(doc);
            const leaf = this.findLeaf(doc);
            const collapse = doc.querySelector(".sidebar-toggle-button.mod-right");
            const host = collapse?.parentElement || doc.querySelector(".mod-root .workspace-tab-header-container");
            this.refreshHeaders(doc, entry, !!host);
            const buttons = [leaf?.view.modeButtonEl, leaf?.view.moreOptionsButtonEl].filter(Boolean);
            if (!host || !buttons.length) {
                this.restore(entry);
                entry.toolbar.remove();
                doc.body.classList.remove("pw-note-navigation-enabled");
                continue;
            }
            if (entry.leaf !== leaf || buttons.some((button, index) => entry.slots[index]?.button !== button)) {
                this.restore(entry);
                entry.leaf = leaf;
                entry.slots = buttons.map((button) => {
                    const marker = doc.createComment("Patchwork note action");
                    button.before(marker);
                    const parent = button.parentElement;
                    entry.toolbar.append(button);
                    return { button, marker, parent };
                });
                entry.observer.observe(leaf.view.headerEl, { childList: true, subtree: true });
            }
            if (entry.toolbar.parentElement !== host || (collapse && entry.toolbar.nextSibling !== collapse)) {
                host.insertBefore(entry.toolbar, collapse || null);
            }
            doc.body.classList.add("pw-note-navigation-enabled");
        }
    }

    refreshHeaders(doc, entry, enabled) {
        const headers = new Set();
        if (enabled) {
            this.app.workspace.iterateAllLeaves((leaf) => {
                const view = leaf.view;
                if (view.file && view.headerEl && view.containerEl.ownerDocument === doc
                    && view.containerEl.closest(".mod-root")) headers.add(view.headerEl);
            });
        }
        for (const header of entry.headers) {
            if (!headers.has(header)) header.classList.remove("pw-document-header");
        }
        for (const header of headers) header.classList.add("pw-document-header");
        entry.headers = headers;
    }

    attach(doc) {
        const toolbar = doc.createElement("div");
        toolbar.className = "pw-note-navigation";
        toolbar.setAttribute("role", "toolbar");
        toolbar.setAttribute("aria-label", "Document actions");
        const entry = { toolbar, slots: [], headers: new Set(), observer: new doc.defaultView.MutationObserver(() => this.schedule()) };
        const activate = () => {
            if (entry.leaf) this.app.workspace.setActiveLeaf(entry.leaf, { focus: false });
        };
        const keydown = (event) => this.navigate(doc, event);
        toolbar.addEventListener("pointerdown", activate, true);
        toolbar.addEventListener("focusin", activate);
        doc.defaultView.addEventListener("keydown", keydown, true);
        entry.cleanup = () => {
            toolbar.removeEventListener("pointerdown", activate, true);
            toolbar.removeEventListener("focusin", activate);
            doc.defaultView.removeEventListener("keydown", keydown, true);
        };
        this.documents.set(doc, entry);
        return entry;
    }

    navigate(doc, event) {
        if (event.defaultPrevented || event.isComposing || !event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        const target = event.target?.nodeType === 1 ? event.target : event.target?.parentElement;
        if (!target || target.isContentEditable
            || target.closest("input, textarea, select, [role='textbox'], .cm-editor, .claudian-container, .modal-container, .menu")) return;
        const leaf = this.findLeaf(doc);
        if (!leaf) return;
        this.app.workspace.setActiveLeaf(leaf, { focus: false });
        if (!this.app.commands.executeCommandById(event.key === "ArrowLeft" ? "app:go-back" : "app:go-forward")) return;
        event.preventDefault();
        event.stopImmediatePropagation();
    }

    restore(entry) {
        entry.observer.disconnect();
        for (const { button, marker, parent } of entry.slots) {
            if (marker.parentNode) marker.replaceWith(button);
            else parent?.append(button);
        }
        entry.slots = [];
        entry.leaf = undefined;
    }

    detach(doc, entry) {
        this.restore(entry);
        for (const header of entry.headers) header.classList.remove("pw-document-header");
        entry.headers.clear();
        entry.cleanup();
        entry.toolbar.remove();
        doc.body.classList.remove("pw-note-navigation-enabled");
    }

    dispose() {
        this.disposed = true;
        for (const [doc, entry] of this.documents) this.detach(doc, entry);
        this.documents.clear();
    }
}

export { NoteNavigation };
