import type { Plugin } from "obsidian";
import type { Disposable } from "../../../contracts/common";
import type { BordersApi } from "../../../contracts/borders";
import { getServiceRegistry } from "../../../utils/service-registry";
import { createNativePanel } from "../../../utils/native-panel";
import { hasUpstreamPanel } from "./upstream";

/** Capability is the upstream registered view, not the companion's load order. */
export function installBordersIntegration(plugin: Plugin): void {
    let handle: Disposable | undefined;
    let provider: BordersApi | undefined;
    const sync = () => {
        const supported = hasUpstreamPanel(plugin.app);
        if (!provider || !supported) { handle?.dispose(); handle = undefined; return; }
        if (handle) return;
        handle = provider.registerPanel({
            id: "claudian", owner: "claudian", label: "Claudian", icon: "claudian", dock: "right",
            rail: "right", railGroup: "main", order: 10, host: { kind: "native-leaf", viewType: "claudian-view" },
            bounds: { minWidth: 200, maxWidth: 531, maxWidthRatio: 0.8 }, resizeMode: "preview",
            create: (host, context) => createNativePanel(plugin.app, host, context),
        });
    };
    const stop = getServiceRegistry(plugin.app).watch("claudian", "borders", borders => {
        handle?.dispose(); handle = undefined; provider = borders; sync();
    });
    plugin.registerEvent(plugin.app.workspace.on("layout-change", sync));
    plugin.app.workspace.onLayoutReady(sync);
    plugin.register(() => { stop(); handle?.dispose(); });
}
