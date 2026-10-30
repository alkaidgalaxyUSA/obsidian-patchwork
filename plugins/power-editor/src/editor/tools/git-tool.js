import { ToolTabs } from "./tool-tabs";
import { GitLogPane } from "./git-log-pane";

export class GitTool {
    constructor(plugin, host, hide) {
        this.plugin = plugin;
        this.tabs = new ToolTabs(host, "Git", () => this.add(), hide);
    }

    add() {
        let tab;
        const pane = new GitLogPane(this.plugin, this.tabs.body, label => {
            if (!tab) return;
            tab.label = label; tab.title.setText(label);
        });
        tab = this.tabs.append("Log", pane);
    }

    show() { if (!this.tabs.tabs.length) this.add(); else void this.tabs.active.pane.refresh(); }
    dispose() { this.tabs.dispose(); }
}
