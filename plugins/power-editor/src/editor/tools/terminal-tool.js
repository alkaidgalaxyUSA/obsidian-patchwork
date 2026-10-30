import { Menu, Notice } from "obsidian";
import { ToolTabs } from "./tool-tabs";
import { PowerShellSession } from "./powershell-session";
import { findTerminalRuntime } from "./utils/terminal-runtime";

export class TerminalTool {
    constructor(plugin, host, hide) {
        this.plugin = plugin;
        this.tabs = new ToolTabs(host, "Terminal", () => this.add(), hide);
        const options = this.tabs.button("Terminal options", "more-vertical", () => this.options(), this.tabs.actions);
        this.tabs.actions.prepend(options);
    }

    add() {
        try {
            if (!this.runtime) {
                this.runtime = findTerminalRuntime();
                this.style = this.tabs.host.ownerDocument.createElement("style");
                this.style.textContent = this.runtime.css;
                this.tabs.host.ownerDocument.head.append(this.style);
            }
            const pane = new PowerShellSession(this.tabs.body, this.runtime, this.plugin.app.vault.adapter.getBasePath());
            this.tabs.append("Local", pane);
        } catch (error) { new Notice(error.message); }
    }

    options() {
        const menu = new Menu();
        menu.addItem(item => item.setTitle("New PowerShell tab").onClick(() => this.add()));
        const pane = this.tabs.active?.pane;
        menu.addItem(item => item.setTitle("Clear terminal").setDisabled(!pane).onClick(() => pane.terminal.clear()));
        menu.addItem(item => item.setTitle("Interrupt command").setDisabled(!pane || pane.exited).onClick(() => pane.send({ type: "input", data: "\x03" })));
        menu.addItem(item => item.setTitle("Close tab").setDisabled(!pane).onClick(() => this.tabs.remove(this.tabs.active)));
        const rect = this.tabs.actions.getBoundingClientRect();
        menu.showAtPosition({ x: rect.right - 190, y: rect.bottom });
    }

    show() { if (!this.tabs.tabs.length) this.add(); else this.tabs.active?.pane.focus(); }
    dispose() { this.tabs.dispose(); this.style?.remove(); }
}
