import type { App, WorkspaceLeaf } from "obsidian";
import type { PanelInstance } from "../contracts/borders";
import type { WindowContext } from "../contracts/common";
import { ModuleUnavailableError } from "./module-errors";

/** Adapt a granted native view without moving its contents or owning its dock. */
export function createNativePanel(app: App, host: HTMLElement, context: WindowContext): PanelInstance {
    let leaf: WorkspaceLeaf | undefined;
    app.workspace.iterateAllLeaves(candidate => {
        if (candidate.view.containerEl.ownerDocument === context.document && candidate.view.containerEl.contains(host)) leaf = candidate;
    });
    if (!leaf) throw new ModuleUnavailableError("borders", "The granted native view was closed.");
    const target = leaf;
    return {
        async show(options) {
            options.context.signal?.throwIfAborted();
            if (!target.view.containerEl.isConnected) throw new ModuleUnavailableError("borders", "The native panel was closed.");
            await target.loadIfDeferred();
            app.workspace.setActiveLeaf(target, { focus: options.focus !== false });
        },
        hide() {},
        focus() { app.workspace.setActiveLeaf(target, { focus: true }); },
        resize() { target.view.onResize(); },
        dispose() {},
    };
}
