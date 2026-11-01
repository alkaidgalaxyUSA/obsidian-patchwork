import type { Plugin } from "obsidian";
import { migrateSettings } from "../../utils/settings-migration";

type StoredSettings = Record<string, unknown>;

function record(value: unknown): StoredSettings {
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value as StoredSettings : {};
}

/** Borders writes geometry only, preserving migration markers and unknown data. */
export class BordersSettings {
    private data: StoredSettings = {};
    private pending: Promise<void> = Promise.resolve();
    private requested?: boolean;
    migrated = false;

    constructor(private readonly plugin: Plugin) {}

    async load(): Promise<void> { this.data = record(await this.plugin.loadData()); }

    async migrate(): Promise<void> {
        this.data = await migrateSettings(this.plugin, {
            id: "module-isolation", version: 1, donorId: "patchwork-power-editor",
            select: donor => typeof donor.explorerCollapsed === "boolean" ? { panels: { project: { collapsed: donor.explorerCollapsed } } } : {},
        });
        this.migrated = true;
    }

    get projectCollapsed(): boolean | undefined {
        const value = record(record(this.data.panels).project).collapsed;
        return typeof value === "boolean" ? value : undefined;
    }

    saveProjectCollapsed(collapsed: boolean): void {
        if (!this.migrated || this.requested === collapsed || this.requested === undefined && this.projectCollapsed === collapsed) return;
        this.requested = collapsed;
        this.pending = this.pending.catch(() => {}).then(async () => {
            const next = record(await this.plugin.loadData());
            const panels = record(next.panels), project = record(panels.project);
            const requested = this.requested;
            if (requested === undefined) return;
            const data = { ...next, panels: { ...panels, project: { ...project, collapsed: requested } } };
            await this.plugin.saveData(data); this.data = data;
            if (this.requested === requested) this.requested = undefined;
        });
        void this.pending.catch(error => { this.requested = undefined; console.error("Could not save Borders geometry.", error); });
    }

    flush(): Promise<void> { return this.pending; }
}
