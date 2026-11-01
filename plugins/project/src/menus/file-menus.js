import { getWindowContext, resolveWindow } from "../../../utils/windows";
import { scopeModule } from "../../../utils/module-scope";
import { renderFileActions } from "../../../utils/file-menu-actions";

/** Project controls root ordering; contributors own only their semantic submenu. */
export class FileMenus {
    constructor(plugin) { this.plugin = plugin; this.contributions = new Map(); this.open = new Map(); }

    register(contribution) {
        if (this.disposed || this.contributions.has(contribution.id)) throw new Error(`File menu already registered or disposed: ${contribution.id}`);
        const record = { contribution }; this.contributions.set(contribution.id, record);
        return { dispose: () => {
            if (this.contributions.get(contribution.id) !== record) return;
            this.contributions.delete(contribution.id);
            for (const [menu, mounted] of this.open) if (mounted.records.has(record)) menu.hide();
        } };
    }

    apply(menu, targets) {
        if (this.disposed || this.open.has(menu)) return;
        const context = { ...getWindowContext(menu.dom.ownerDocument), targets, source: "project" };
        const mounted = { records: new Set(), handles: [], scope: scopeModule(menu.dom, "project", { surface: "file-menu" }) };
        this.open.set(menu, mounted);
        menu.onHide(() => this.release(menu));
        for (const record of [...this.contributions.values()].sort((a, b) => a.contribution.order - b.contribution.order)) {
            const contribution = record.contribution;
            try {
                const actions = contribution.build(context);
                if (!actions.length) continue;
                mounted.records.add(record);
                mounted.handles.push(renderFileActions(menu, actions, contribution.owner, () => !this.disposed
                    && this.contributions.get(contribution.id) === record
                    && resolveWindow(context.windowId)?.document === context.document));
            } catch (error) { console.error("Project file-menu contribution failed.", error); }
        }
    }

    release(menu) {
        const mounted = this.open.get(menu); if (!mounted) return;
        this.open.delete(menu);
        for (const handle of mounted.handles) handle.dispose();
        mounted.scope.dispose();
    }

    dispose() {
        this.disposed = true;
        for (const menu of [...this.open.keys()]) { menu.hide(); this.release(menu); }
        this.contributions.clear();
    }
}
