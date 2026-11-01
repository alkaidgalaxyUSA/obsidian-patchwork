import { ToolTabs } from "../../../utils/tool-tabs";
import { GitLogPane } from "./git-log-pane";

export class GitTool {
    constructor(controller, host, hide) {
        this.controller = controller;
        this.tabs = new ToolTabs(host, "git", "Git", () => this.add(), hide);
        controller.logTools.set(host.ownerDocument, this);
    }

    add() {
        let tab;
        const pane = new GitLogPane(this.controller, this.tabs.body, label => {
            if (!tab) return;
            tab.label = label; tab.title.setText(label);
        });
        tab = this.tabs.append("Log", pane);
        return pane;
    }

    show() { if (!this.tabs.tabs.length) this.add(); else void this.tabs.active.pane.refresh(); }
    async openHistory(paths) { const pane = this.add(); await pane.setHistoryPaths(paths); return pane; }
    dispose() {
        if (this.controller.logTools.get(this.tabs.host.ownerDocument) === this) this.controller.logTools.delete(this.tabs.host.ownerDocument);
        this.tabs.dispose();
    }
}
