import { scopeModule } from "../../../utils/module-scope";

/** One native Editor-settings hook, with dedicated feature-owned mount slots. */
export class SettingsHost {
    constructor(app) {
        this.app = app; this.contributions = new Map(); this.mounts = new Map();
        this.observer = new app.workspace.containerEl.ownerDocument.defaultView.MutationObserver(() => this.clean());
        this.observer.observe(app.workspace.containerEl.ownerDocument.body, { childList: true, subtree: true });
        this.sync();
    }

    sync() {
        const tab = this.app.setting?.settingTabs?.find(item => item.id === "editor");
        if (this.tab === tab || !tab?.getSettingDefinitions) return;
        this.restore(); this.tab = tab; this.original = tab.getSettingDefinitions;
        const owner = this, lease = { enabled: true, original: this.original };
        this.lease = lease;
        this.wrapper = function (...args) {
            if (!lease.enabled) return lease.original.apply(this, args);
            const items = [...owner.contributions.values()].sort((a, b) => a.order - b.order).map(contribution => ({
                name: "", render(row) {
                    row.settingEl.classList.add("pw-settings-contribution-row");
                    const host = row.settingEl.createDiv({ cls: "pw-settings-contribution" });
                    const scope = scopeModule(host, contribution.owner, { contribution: true });
                    let mounted;
                    try { mounted = contribution.mount(host); }
                    catch (error) { scope.dispose(); host.remove(); throw error; }
                    owner.mounts.set(host, { id: contribution.id, mounted, scope });
                },
            }));
            return [...owner.original.apply(this, args), ...(items.length ? [{ type: "group", heading: "Patchwork", items }] : [])];
        };
        tab.getSettingDefinitions = this.wrapper;
    }

    add(contribution) { this.contributions.set(contribution.id, contribution); this.sync(); }
    remove(id) {
        this.contributions.delete(id);
        for (const [host, record] of this.mounts) if (record.id === id) this.unmount(host, record);
    }
    unmount(host, record) {
        this.mounts.delete(host);
        try { record.mounted.dispose(); }
        catch (error) { console.error("Patchwork settings cleanup failed.", error); }
        finally { record.scope.dispose(); host.remove(); }
    }
    clean() { for (const [host, record] of this.mounts) if (!host.isConnected) this.unmount(host, record); }
    restore() {
        if (this.lease) this.lease.enabled = false;
        if (this.tab && this.tab.getSettingDefinitions === this.wrapper) this.tab.getSettingDefinitions = this.original;
        for (const [host, record] of this.mounts) this.unmount(host, record);
    }
    dispose() { this.observer.disconnect(); this.restore(); this.contributions.clear(); }
}
