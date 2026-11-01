import type { App } from "obsidian";

/** Read-only compatibility with Power Connect's startup settling state. */
export function powerConnectSettling(app: App): boolean {
    const plugin = (app as unknown as { plugins?: { plugins?: Record<string, { running?: boolean; mobileStartupPending?: boolean }> } }).plugins?.plugins?.powerconnect;
    return plugin?.running === true || plugin?.mobileStartupPending === true;
}
