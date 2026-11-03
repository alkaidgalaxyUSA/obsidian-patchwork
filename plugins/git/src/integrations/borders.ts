import type { Disposable } from "../../../contracts/common";
import { getServiceRegistry } from "../../../utils/service-registry";
import { createNativePanel } from "../../../utils/native-panel";
import { COMMIT_VIEW } from "../commit/commit-view";
import { GitTool } from "../log/git-tool";
import { BranchHeader } from "../header/branch-header";
import type PatchworkGitPlugin from "../main";
import { iconName } from "../utils/icons";

export function installBordersIntegration(plugin: PatchworkGitPlugin): void {
    let handles: Disposable[] = [];
    const clear = () => { for (const handle of handles.reverse()) handle.dispose(); handles = []; };
    const stop = getServiceRegistry(plugin.app).watch("git", "borders", borders => {
        clear();
        if (!borders) return;
        handles.push(borders.registerPanel({
            id: "git:commit", owner: "git", label: "Commit", icon: iconName("idea/expui/toolwindows/commit_dark.svg"), dock: "left",
            rail: "left", railGroup: "main", order: 20, host: { kind: "native-leaf", viewType: COMMIT_VIEW },
            create: (host, context) => createNativePanel(plugin.app, host, context),
        }));
        handles.push(borders.registerPanel({
            id: "git:log", owner: "git", label: "Git", icon: iconName("idea/expui/toolwindows/vcs_dark.svg"), dock: "bottom",
            rail: "left", railGroup: "tools", order: 20, host: { kind: "element" },
            create(host, context) {
                const tool = new GitTool(plugin.controller, host, () => borders.hidePanel("git:log", context));
                return {
                    async show(options) { if (options.payload?.newTab) tool.add(); else tool.show(); },
                    hide() {}, focus() { tool.tabs.active?.pane.focus(); }, resize() {},
                    dispose() { tool.dispose(); },
                };
            },
        }));
        handles.push(borders.registerHeader({
            id: "git:branch", owner: "git", order: 10,
            mount: (host, context) => new BranchHeader(plugin.controller, host, context),
        }));
    });
    plugin.register(() => { stop(); clear(); });
}
