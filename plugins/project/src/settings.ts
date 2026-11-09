import type { Plugin } from "obsidian";
import { migrateSettings } from "../../utils/settings-migration";

export interface ProjectPreferences {
    explorerFilesFirst: boolean;
    explorerCompact: boolean;
    explorerAppearance: string;
    explorerOpenInNewTab: boolean;
    hideAttachmentFolders: boolean;
}

const defaults: ProjectPreferences = {
    explorerFilesFirst: false, explorerCompact: false, explorerAppearance: "github",
    explorerOpenInNewTab: true, hideAttachmentFolders: true,
};

function select(data: Record<string, unknown>): Partial<ProjectPreferences> {
    const result: Partial<ProjectPreferences> = {};
    for (const key of ["explorerFilesFirst", "explorerCompact", "explorerOpenInNewTab", "hideAttachmentFolders"] as const) {
        if (typeof data[key] === "boolean") result[key] = data[key];
    }
    result.explorerAppearance = "github";
    return result;
}

/** Import validated missing values once; preserve donor and unknown target keys. */
export class ProjectSettings {
    private pending: Promise<void> = Promise.resolve();
    private baseline: ProjectPreferences = { ...defaults };
    constructor(private readonly plugin: Plugin) {}

    async load(): Promise<ProjectPreferences> {
        const data = await migrateSettings(this.plugin, {
            id: "module-isolation", version: 1, donorId: "patchwork-power-editor", select,
        });
        const preferences = { ...defaults, ...select(data) };
        this.baseline = { ...preferences };
        if (data.explorerAppearance !== "github") await this.save(preferences);
        return preferences;
    }

    save(preferences: ProjectPreferences): Promise<void> {
        const values = select({ ...preferences });
        const changes = Object.fromEntries(Object.entries(values).filter(([key, value]) => value !== this.baseline[key as keyof ProjectPreferences]));
        this.pending = this.pending.catch(() => {}).then(async () => {
            const latest = await this.plugin.loadData();
            if (latest !== null && latest !== undefined && (typeof latest !== "object" || Array.isArray(latest))) throw new Error("Project settings must be a JSON object.");
            const resolved = { ...defaults, ...select(latest ?? {}), ...changes };
            await this.plugin.saveData({ ...latest, ...resolved });
            for (const key of Object.keys(values) as (keyof ProjectPreferences)[]) {
                if (preferences[key] === values[key]) Object.assign(preferences, { [key]: resolved[key] });
            }
            this.baseline = { ...resolved };
        });
        return this.pending;
    }
    flush(): Promise<void> { return this.pending; }
}
