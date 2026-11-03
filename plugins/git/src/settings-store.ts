import type { Plugin } from "obsidian";
import { migrateSettings, type SettingsRecord } from "../../utils/settings-migration";

export interface GitPopupOptions {
    showActions: boolean;
    groupByPrefix: boolean;
    showRecent: boolean;
    showTags: boolean;
}

const defaults: GitPopupOptions = { showActions: true, groupByPrefix: false, showRecent: true, showTags: false };

function record(value: unknown): SettingsRecord {
    if (value === null || value === undefined) return {};
    if (typeof value !== "object" || Array.isArray(value)) throw new Error("Git settings must be a JSON object.");
    return value as SettingsRecord;
}

function popupValues(value: unknown): Partial<GitPopupOptions> {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const values: Partial<GitPopupOptions> = {};
    for (const key of Object.keys(defaults) as (keyof GitPopupOptions)[]) {
        const candidate = Reflect.get(value, key);
        if (typeof candidate === "boolean") values[key] = candidate;
    }
    return values;
}

/** Single serialized writer; draft and popup updates merge with the latest disk data. */
export class GitSettingsStore {
    private pending: Promise<void> = Promise.resolve();
    readonly popup: GitPopupOptions = { ...defaults };
    preferences: SettingsRecord = {};
    constructor(private readonly plugin: Plugin) {}

    async load(): Promise<SettingsRecord> {
        await this.pending.catch(() => {});
        const data = await migrateSettings(this.plugin, {
            id: "module-isolation", version: 1, donorId: "patchwork-power-editor",
            select: donor => ({ gitPopupOptions: popupValues(donor.gitPopupOptions) }),
        });
        Object.assign(this.popup, defaults, popupValues(data.gitPopupOptions));
        this.preferences = record(data.gitPreferences);
        return data;
    }

    savePopup(key: keyof GitPopupOptions, value: boolean): Promise<void> {
        this.popup[key] = value;
        return this.enqueue(latest => ({ ...latest, gitPopupOptions: { ...record(latest.gitPopupOptions), [key]: value } }));
    }

    saveDraft(message: string, amend: boolean, changelists: unknown, commitMode: "working" | "staged", root: string): Promise<void> {
        const snapshot = structuredClone({ message, amend, changelists, commitMode });
        const drafts = record(this.preferences.repositoryDrafts);
        this.preferences.repositoryDrafts = { ...drafts, [root]: snapshot };
        return this.enqueue(latest => {
            const preferences = record(latest.gitPreferences);
            return { ...latest, ...snapshot, draftRepository: root, gitPreferences: { ...preferences, repositoryDrafts: { ...record(preferences.repositoryDrafts), [root]: snapshot } } };
        });
    }

    savePreferences(values: SettingsRecord): Promise<void> {
        const snapshot = structuredClone(values);
        Object.assign(this.preferences, snapshot);
        return this.enqueue(latest => ({ ...latest, gitPreferences: { ...record(latest.gitPreferences), ...snapshot } }));
    }

    private enqueue(merge: (latest: SettingsRecord) => SettingsRecord): Promise<void> {
        this.pending = this.pending.catch(() => {}).then(async () => {
            const latest = record(await this.plugin.loadData());
            await this.plugin.saveData(merge(latest));
        });
        return this.pending;
    }

    flush(): Promise<void> { return this.pending; }
}
