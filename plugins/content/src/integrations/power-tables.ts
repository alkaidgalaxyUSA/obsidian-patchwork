import type { App } from "obsidian";

/** Optional upstream capability; no settings or implementation is shared. */
export function powerTablesActive(app: App): boolean {
    const plugins = (app as unknown as { plugins?: { enabledPlugins?: Set<string>; plugins?: Record<string, unknown> } }).plugins;
    return !!plugins?.plugins?.powertables || !!plugins?.enabledPlugins?.has("powertables");
}
