import type { Plugin } from "obsidian";
import type { ClaudianApi } from "../../contracts/claudian";
import { getServiceRegistry } from "../../utils/service-registry";
import { resolveWindow } from "../../utils/windows";
import { ModuleUnavailableError } from "../../utils/module-errors";
import { hasUpstreamPanel } from "./integrations/upstream";

export function installClaudianApi(plugin: Plugin): void {
    let disposed = false;
    const registry = getServiceRegistry(plugin.app);
    const api: ClaudianApi = { version: 1, async open(context) {
        const validate = () => {
            context.signal?.throwIfAborted();
            if (disposed || resolveWindow(context.windowId)?.document !== context.document || !hasUpstreamPanel(plugin.app)) {
                throw new ModuleUnavailableError("claudian", "Claudian is unavailable in this window.");
            }
        };
        validate();
        const borders = registry.get("borders");
        if (borders) { await borders.openPanel("claudian", { context, focus: true }); validate(); return; }
        let leaf = plugin.app.workspace.getLeavesOfType("claudian-view").find(item => item.view.containerEl.ownerDocument === context.document);
        if (!leaf) {
            if (context.document !== plugin.app.workspace.containerEl.ownerDocument) throw new ModuleUnavailableError("claudian", "This window has no native Claudian panel.");
            leaf = plugin.app.workspace.getRightLeaf(false) ?? undefined;
            if (!leaf) throw new ModuleUnavailableError("claudian", "The right sidebar is unavailable.");
            await leaf.setViewState({ type: "claudian-view", active: true });
        }
        validate(); await plugin.app.workspace.revealLeaf(leaf); validate();
    } };
    const registration = registry.register("claudian", "claudian", api);
    plugin.register(() => { disposed = true; registration.dispose(); });
}
