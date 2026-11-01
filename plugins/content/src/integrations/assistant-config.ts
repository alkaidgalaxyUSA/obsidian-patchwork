import type { App } from "obsidian";

/** Read-only optional defaults; credentials never leave this local adapter path. */
export function assistantConfig(app: App): Record<string, string> {
    const plugins = (app as unknown as { plugins?: { plugins?: Record<string, { settings?: Record<string, string> }> } }).plugins?.plugins;
    const settings = (plugins?.powerassistant ?? plugins?.powercapture)?.settings;
    return Object.fromEntries(["transcriptionEndpoint", "transcriptionKey", "transcriptionModel", "anthropicKey"]
        .filter(key => typeof settings?.[key] === "string").map(key => [key, settings![key]]));
}
