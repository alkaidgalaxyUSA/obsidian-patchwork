import { Notice, type Plugin } from "obsidian";
import { isAbsolute } from "node:path";
import { stat } from "node:fs/promises";
import type { Disposable } from "../../contracts/common";
import type { TerminalOpenRequest } from "../../contracts/terminal";
import { getServiceRegistry } from "../../utils/service-registry";
import { getWindowContext, resolveWindow } from "../../utils/windows";
import { ModuleUnavailableError } from "../../utils/module-errors";
import { TerminalTool } from "./terminal-tool";
import { createTerminalApi } from "./api";

export class TerminalRuntime {
    private disposed = false;
    private panel?: Disposable;
    private stop?: () => void;
    private service?: Disposable;
    constructor(private readonly plugin: Plugin) {}

    install(): void {
        const registry = getServiceRegistry(this.plugin.app);
        this.service = registry.register("terminal", "terminal", createTerminalApi(this));
        this.stop = registry.watch("terminal", "borders", borders => {
            this.panel?.dispose(); this.panel = undefined;
            if (!borders || this.disposed) return;
            this.panel = borders.registerPanel({
                id: "terminal", owner: "terminal", label: "Terminal", icon: "terminal", dock: "bottom",
                rail: "left", railGroup: "tools", order: 10, host: { kind: "element" },
                create: (host, context) => {
                    const tool = new TerminalTool(this.plugin, host, () => borders.hidePanel("terminal", context));
                    return {
                        async show(options) {
                            if (options.payload?.newTab && !options.payload.cwd) tool.add(undefined, false);
                            else tool.show(options.payload?.cwd);
                        },
                        hide() {}, focus() { tool.tabs.active?.pane.focus(); },
                        resize() { for (const tab of tool.tabs.tabs) tab.pane.fit(); },
                        dispose() { tool.dispose(); },
                    };
                },
            });
        });
        this.plugin.addCommand({ id: "open-terminal", name: "Open Terminal", callback: () => {
            const context = getWindowContext(this.plugin.app.workspace.containerEl.ownerDocument);
            void this.open(context).catch(error => new Notice(error.message));
        } });
    }

    private validate(request: TerminalOpenRequest): void {
        request.signal?.throwIfAborted();
        if (this.disposed || resolveWindow(request.windowId)?.document !== request.document) throw new ModuleUnavailableError("terminal", "The Terminal window was closed.");
    }

    async open(request: TerminalOpenRequest): Promise<void> {
        this.validate(request);
        if (request.cwd && (!isAbsolute(request.cwd) || !(await stat(request.cwd)).isDirectory())) throw new Error("Terminal CWD must be an existing absolute directory.");
        this.validate(request);
        const borders = getServiceRegistry(this.plugin.app).get("borders");
        if (!borders) throw new ModuleUnavailableError("borders", "Enable Borders to open Terminal.");
        await borders.openPanel("terminal", { context: request, focus: request.focus, payload: { cwd: request.cwd, newTab: request.newTab } });
        this.validate(request);
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true; this.service?.dispose(); this.stop?.(); this.panel?.dispose();
    }
}
