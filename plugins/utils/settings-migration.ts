import { normalizePath } from "obsidian";
import type { Plugin } from "obsidian";

export type SettingsRecord = Record<string, unknown>;

export interface SettingsMigration {
    id: string;
    version: number;
    donorId: string;
    /** Return validated donor values only; do not merge target defaults here. */
    select(donor: Readonly<SettingsRecord>): SettingsRecord;
}

interface MigrationHost {
    pending: Map<string, Promise<void>>;
}

const hostKey = Symbol.for("patchwork.settings-migrations.v1");
const markerKey = "patchworkMigrations";

function isRecord(value: unknown): value is SettingsRecord {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeMissing(target: SettingsRecord, donor: SettingsRecord): SettingsRecord {
    const merged = { ...target };
    for (const [key, value] of Object.entries(donor)) {
        if (["__proto__", "prototype", "constructor", markerKey].includes(key)) continue;
        if (!Object.prototype.hasOwnProperty.call(target, key)) {
            Object.defineProperty(merged, key, { value, writable: true, enumerable: true, configurable: true });
            continue;
        }
        if (isRecord(target[key]) && isRecord(value)) merged[key] = mergeMissing(target[key], value);
    }
    return merged;
}

function readRecord(value: unknown): SettingsRecord {
    if (value === null || value === undefined) return {};
    if (!isRecord(value)) throw new Error("Patchwork settings must be a JSON object.");
    return value;
}

/**
 * Serialize per target across bundles, read stored target values before defaults,
 * and commit imports with their version marker in one save. Donors are read only.
 * Missing donors and failed reads/saves remain retryable, without a success marker.
 * Later writers must preserve unknown keys and use their module's merged store.
 */
export async function migrateSettings(plugin: Plugin, migration: SettingsMigration): Promise<SettingsRecord> {
    if (!/^[a-z0-9-]+$/.test(migration.donorId)
        || !/^[a-z0-9-]+$/.test(migration.id)
        || !Number.isInteger(migration.version) || migration.version < 1) {
        throw new Error("Invalid Patchwork settings migration.");
    }
    const existing = Reflect.get(plugin.app, hostKey) as MigrationHost | undefined;
    const host: MigrationHost = existing ?? { pending: new Map() };
    if (!existing) Object.defineProperty(plugin.app, hostKey, { value: host });
    const targetId = plugin.manifest.id;
    if (migration.donorId === targetId) throw new Error("Migration donor must differ from its target.");
    const previous = host.pending.get(targetId) ?? Promise.resolve();
    const operation = previous.then(async () => {
        const target = readRecord(await plugin.loadData());
        const markers = readRecord(target[markerKey]);
        const currentVersion = markers[migration.id];
        if (typeof currentVersion === "number" && currentVersion >= migration.version) return target;
        const path = normalizePath(`${plugin.app.vault.configDir}/plugins/${migration.donorId}/data.json`);
        const adapter = plugin.app.vault.adapter;
        if (!await adapter.exists(path)) return target;
        const donor = readRecord(JSON.parse(await adapter.read(path)));
        const imported = migration.select(donor);
        // Re-read after donor IO so a concurrent settings change takes precedence.
        const latest = readRecord(await plugin.loadData());
        const latestMarkers = readRecord(latest[markerKey]);
        const latestVersion = latestMarkers[migration.id];
        if (typeof latestVersion === "number" && latestVersion >= migration.version) return latest;
        const merged = mergeMissing(latest, imported);
        merged[markerKey] = { ...latestMarkers, [migration.id]: migration.version };
        await plugin.saveData(merged);
        return merged;
    });
    const settled = operation.then(() => {}, () => {});
    host.pending.set(targetId, settled);
    try {
        return await operation;
    } finally {
        if (host.pending.get(targetId) === settled) host.pending.delete(targetId);
    }
}
