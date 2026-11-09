import { getWindowContext } from "../../../utils/windows";
import { codeDocuments } from "../integrations/code-document";

/** Window-local, bounded close history. Never retain document contents. */
export class ClosedDocumentTabs {
    constructor(plugin) {
        this.app = plugin.app;
        this.records = new WeakMap();
        this.leases = new Map();
        plugin.registerEvent(this.app.workspace.on("layout-change", () => this.sync()));
        plugin.register(() => {
            this.disposed = true;
            for (const [leaf, lease] of this.leases) this.release(leaf, lease);
            this.leases.clear();
            this.records = new WeakMap();
        });
        this.sync();
    }

    snapshot(leaf) {
        const file = leaf.view.file;
        if (!file) return undefined;
        const state = leaf.getViewState();
        const item = { path: file.path, type: state.type, mode: state.state?.mode, source: state.state?.source,
            pinned: !!leaf.pinned, index: leaf.parent.children.indexOf(leaf) };
        // Encrypted notes reopen through their owning provider, without editor state.
        if (/\.mdenc$/i.test(file.path)) return item;
        const cursor = leaf.view.editor?.getCursor?.();
        if (cursor) item.cursor = { line: cursor.line, ch: cursor.ch };
        const scroll = leaf.view.editor?.getScrollInfo?.();
        if (scroll) item.scroll = { left: scroll.left, top: scroll.top };
        const context = getWindowContext(leaf.view.containerEl.ownerDocument);
        const code = codeDocuments(this.app);
        const snapshot = code?.supports(leaf.id, context) ? code.getSnapshot(leaf.id, context) : undefined;
        if (snapshot?.cursor) item.codeLocation = { ...snapshot.cursor, scrollTop: snapshot.scrollTop };
        return item;
    }

    release(leaf, lease) {
        if (leaf.detach === lease.wrapper) leaf.detach = lease.original;
    }

    sync() {
        if (this.disposed) return;
        const leaves = new Set();
        this.app.workspace.iterateAllLeaves(leaf => {
            if (leaf.view.containerEl.closest(".mod-root")) leaves.add(leaf);
        });
        for (const [leaf, lease] of this.leases) if (!leaves.has(leaf)) {
            this.release(leaf, lease); this.leases.delete(leaf);
        }
        for (const leaf of leaves) {
            if (this.leases.has(leaf)) continue;
            const owner = this;
            const original = leaf.detach;
            const wrapper = function (...args) {
                let item;
                const doc = this.view.containerEl.ownerDocument;
                try { if (!owner.disposed) item = owner.snapshot(this); } catch { /* Closing must remain available. */ }
                const result = original.apply(this, args);
                if (item && !owner.disposed && !owner.app.workspace.isAttached(this) && !doc.defaultView.closed) {
                    const history = owner.records.get(doc) ?? [];
                    history.unshift(item);
                    history.length = Math.min(history.length, 30);
                    owner.records.set(doc, history);
                }
                return result;
            };
            leaf.detach = wrapper;
            this.leases.set(leaf, { original, wrapper });
        }
    }

    peek(doc) {
        const history = this.records.get(doc);
        while (history?.length && !this.app.vault.getFileByPath(history[0].path)) history.shift();
        return history?.[0];
    }

    consume(doc, item) {
        const history = this.records.get(doc);
        const index = history?.indexOf(item) ?? -1;
        if (index >= 0) history.splice(index, 1);
    }
}
