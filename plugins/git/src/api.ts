import type { GitApi } from "../../contracts/git";
import type { CallContext } from "../../contracts/common";
import { getServiceRegistry } from "../../utils/service-registry";
import { resolveWindow } from "../../utils/windows";
import { ModuleUnavailableError } from "../../utils/module-errors";
import type { GitController } from "./controller";
import { buildGitFileActions } from "./context-menu";

export function installGitApi(controller: GitController): void {
    const { app, plugin } = controller;
    const registry = getServiceRegistry(app);
    const validate = (context: CallContext, mainWindow = false) => {
        context.signal?.throwIfAborted();
        if (controller.disposed || resolveWindow(context.windowId)?.document !== context.document
            || mainWindow && context.document !== app.workspace.containerEl.ownerDocument) {
            throw new ModuleUnavailableError("git", "The requested Git operation is unavailable in this window.");
        }
    };
    const api: GitApi = {
        version: 1,
        getSnapshot: () => controller.snapshots.snapshot(),
        onSnapshot: listener => controller.snapshots.subscribe(listener),
        async refresh(context) { validate(context); await controller.refresh(); validate(context); },
        async openCommit(paths, context) {
            validate(context, true);
            await controller.openSelection(paths.map(path => controller.repository.path(path)));
            validate(context, true);
        },
        async openLog(context) {
            validate(context);
            const borders = registry.get("borders");
            if (!borders) throw new ModuleUnavailableError("borders", "Enable Borders to open Git Log.");
            await borders.openPanel("git:log", { context, focus: true });
            validate(context);
        },
        async showDiff(paths, options, context) {
            validate(context, true);
            await controller.showDiff(paths.map(path => controller.repository.path(path)), options.newTab);
            validate(context, true);
        },
        buildFileActions(context) {
            validate(context);
            let paths: string[];
            try { paths = context.targets.map(target => controller.repository.path(target.path)); }
            catch { return []; }
            return buildGitFileActions(controller, paths, () => validate(context, true));
        },
    };
    const registration = registry.register("git", "git", api);
    let menu: { dispose(): void } | undefined;
    const stop = registry.watch("git", "project", project => {
        menu?.dispose(); menu = project?.registerFileMenu({
            id: "git:files", owner: "git", group: "git", order: 10,
            build: context => api.buildFileActions(context),
        });
    });
    plugin.register(() => { stop(); menu?.dispose(); registration.dispose(); });
}
