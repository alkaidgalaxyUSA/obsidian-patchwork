import { getWindowContext } from "../../../utils/windows";
import { codeDocuments } from "../integrations/code-document";
import { ClosedDocumentTabs } from "./closed-document-tabs";

/** Operations on captured native leaves, never on an unrelated active editor. */
export class DocumentTabActions {
    constructor(plugin) {
        this.app = plugin.app;
        this.history = new ClosedDocumentTabs(plugin);
        this.busy = new Set();
        plugin.register(() => { this.disposed = true; this.busy.clear(); });
    }

    validate(leaf, doc, path = leaf.view.file?.path) {
        if (this.disposed || doc.defaultView.closed || !this.app.workspace.isAttached(leaf)
            || leaf.view.containerEl.ownerDocument !== doc || leaf.view.file?.path !== path) {
            throw new Error("The document tab changed or was closed. Open its menu again.");
        }
    }

    groups(leaf) {
        const groups = new Set();
        this.app.workspace.iterateAllLeaves(candidate => {
            if (candidate.getRoot() === leaf.getRoot() && candidate.parent !== leaf.parent
                && candidate.view.containerEl.closest(".mod-root")) groups.add(candidate.parent);
        });
        return [...groups];
    }

    move(leaf, group) {
        const doc = leaf.view.containerEl.ownerDocument;
        this.validate(leaf, doc);
        if (!group?.containerEl.isConnected || group.containerEl.ownerDocument !== doc || group === leaf.parent) {
            throw new Error("The destination tab group is no longer available.");
        }
        leaf.parent.removeChild(leaf);
        group.insertChild(group.children.length, leaf);
        this.app.workspace.setActiveLeaf(leaf, { focus: true });
    }

    async restore(leaf, item, doc) {
        const file = this.app.vault.getFileByPath(item.path);
        if (!file) throw new Error("This file no longer exists.");
        await leaf.openFile(file, { active: false, state: { mode: item.mode, source: item.source } });
        this.validate(leaf, doc, item.path);
        leaf.setPinned(item.pinned);
        if (item.cursor) leaf.view.editor?.setCursor(item.cursor);
        if (item.scroll) leaf.view.editor?.scrollTo(item.scroll.left, item.scroll.top);
        const context = getWindowContext(doc);
        const code = codeDocuments(this.app);
        if (item.codeLocation && code?.supports(leaf.id, context)) {
            await code.navigate({ leafId: leaf.id, path: item.path, ...item.codeLocation }, context);
            this.validate(leaf, doc, item.path);
        }
        this.app.workspace.setActiveLeaf(leaf, { focus: true });
    }

    async open(leaf, { direction, group, move = false }) {
        const doc = leaf.view.containerEl.ownerDocument;
        const path = leaf.view.file?.path;
        const parent = leaf.parent;
        this.validate(leaf, doc, path);
        if (move && group) { this.move(leaf, group); return; }
        if (this.busy.has(leaf)) return;
        this.busy.add(leaf);
        let target;
        try {
            const item = this.history.snapshot(leaf);
            if (!item) throw new Error("Only file tabs can be opened in another group.");
            await leaf.view.save?.();
            this.validate(leaf, doc, path);
            if (leaf.parent !== parent) throw new Error("The source tab group changed.");
            if (group && (!group.containerEl.isConnected || group.containerEl.ownerDocument !== doc)) {
                throw new Error("The destination tab group was closed.");
            }
            target = direction ? this.app.workspace.createLeafBySplit(leaf, direction)
                : this.app.workspace.createLeafInParent(group, group.children.length);
            if (move) {
                this.move(leaf, target.parent);
                target.detach();
                return;
            }
            await this.restore(target, item, doc);
        } catch (error) {
            if (target?.view.getViewType() === "empty") target.detach();
            throw error;
        } finally { this.busy.delete(leaf); }
    }

    async reopen(leaf) {
        const doc = leaf.view.containerEl.ownerDocument;
        this.validate(leaf, doc);
        const item = this.history.peek(doc);
        if (!item || this.busy.has(doc)) return;
        this.busy.add(doc);
        const target = this.app.workspace.createLeafInParent(leaf.parent, Math.min(item.index, leaf.parent.children.length));
        try {
            await this.restore(target, item, doc);
            this.history.consume(doc, item);
        } catch (error) {
            if (target.view.getViewType() === "empty") target.detach();
            throw error;
        } finally { this.busy.delete(doc); }
    }
}
