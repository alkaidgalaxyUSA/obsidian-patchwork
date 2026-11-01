import { ModuleUnavailableError } from "../../utils/module-errors";
import { Menu, Notice } from "obsidian";
import { ToolTabs } from "../../utils/tool-tabs";
import { PowerShellSession } from "./powershell-session";
import { findTerminalRuntime } from "./utils/terminal-runtime";
import { scopeModule } from "../../utils/module-scope";

export class TerminalTool {
    constructor(plugin, host, hide) {
        this.plugin = plugin;
        this.menus = new Set();
        this.tabs = new ToolTabs(host, "terminal", "Terminal", () => this.add(), hide);
        const options = this.tabs.button("Terminal options", "more-vertical", () => this.options(), this.tabs.actions);
        this.tabs.actions.prepend(options);
    }

    add(cwd = this.plugin.app.vault.adapter.getBasePath(), report = true) {
        if (this.disposed) return;
        let pane;
        try {
            if (!this.runtime) {
                this.runtime = findTerminalRuntime();
            }
            pane = new PowerShellSession(this.tabs.body, this.runtime, cwd);
            this.tabs.append("Local", pane);
        } catch (error) {
            pane?.dispose();
            if (!report) throw new ModuleUnavailableError("terminal", error.message);
            new Notice(error.message);
        }
    }

    options() {
        if (this.disposed) return;
        const menu = new Menu();
        const scope = scopeModule(menu.dom, "terminal", { surface: "options" });
        scope.refreshTokens(this.tabs.host);
        this.menus.add(menu);
        menu.onHide(() => { scope.dispose(); this.menus.delete(menu); });
        menu.addItem(item => item.setTitle("New PowerShell tab").onClick(() => this.add()));
        const pane = this.tabs.active?.pane;
        menu.addItem(item => item.setTitle("Clear terminal").setDisabled(!pane).onClick(() => { if (!this.disposed && !pane?.disposed) pane?.terminal.clear(); }));
        menu.addItem(item => item.setTitle("Interrupt command").setDisabled(!pane || pane.exited).onClick(() => { if (!this.disposed && !pane?.disposed) pane?.send({ type: "input", data: "\x03" }); }));
        menu.addItem(item => item.setTitle("Close tab").setDisabled(!pane).onClick(() => { if (!this.disposed) this.tabs.remove(this.tabs.active); }));
        const rect = this.tabs.actions.getBoundingClientRect();
        menu.showAtPosition({ x: rect.right - 190, y: rect.bottom, doc: this.tabs.host.ownerDocument });
    }

    show(cwd) { if (cwd || !this.tabs.tabs.length) this.add(cwd, false); else this.tabs.active?.pane.focus(); }
    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        for (const menu of this.menus) menu.hide();
        this.menus.clear(); this.tabs.dispose();
    }
}
