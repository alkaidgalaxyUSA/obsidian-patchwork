import type { GitApi } from "../../contracts/git";
import type { CallContext } from "../../contracts/common";
import { getServiceRegistry } from "../../utils/service-registry";
import { resolveWindow } from "../../utils/windows";
import { ModuleUnavailableError } from "../../utils/module-errors";
import type { GitController } from "./controller";
import { buildGitFileActions } from "./context-menu";
import { isAbsolute, relative, resolve } from "node:path";

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
        async getFileBaseline(path, context) {
            validate(context);
            if (/\.mdenc$/i.test(path) || !controller.ready || controller.busy) return undefined;
            const root = controller.repository.root;
            const vaultPath = relative(controller.repository.vaultPath, resolve(controller.repository.vaultPath, path));
            if (isAbsolute(vaultPath) || vaultPath === ".." || vaultPath.startsWith("../") || vaultPath.startsWith("..\\")) return undefined;
            const file = controller.repository.path(path);
            const head = await controller.repository.head();
            if (!head) return undefined;
            const entry = controller.entries.find(entry => entry.path === file);
            if (entry?.conflict || entry?.untracked) return undefined;
            const original = entry?.original || file;
            const size = Number((await controller.repository.run(["cat-file", "-s", `${head}:${original}`], { signal: context.signal }).catch(() => "NaN")).trim());
            validate(context);
            if (root !== controller.repository.root) return undefined;
            if (!Number.isFinite(size) && entry?.code[0] === "A") return { revision: head, text: "" };
            if (!Number.isFinite(size) || size > 1024 * 1024) return undefined;
            const bytes = await controller.repository.run(["show", `${head}:${original}`], { encoding: "buffer", signal: context.signal });
            validate(context);
            if (root !== controller.repository.root || head !== await controller.repository.head()) return undefined;
            validate(context);
            if (bytes.includes(0)) return undefined;
            try { return { revision: head, text: new TextDecoder("utf-8", { fatal: true }).decode(bytes).replaceAll("\r\n", "\n") }; }
            catch { return undefined; }
        },
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
