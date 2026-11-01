import { TFolder } from "obsidian";
import { ModuleUnavailableError } from "../../../utils/module-errors";

export function openFileRecovery(app, path) {
    const recovery = app.internalPlugins?.plugins?.["file-recovery"];
    if (!recovery?.enabled || typeof recovery.instance?.openModal !== "function") throw new ModuleUnavailableError("project", "Enable File recovery to view local history.");
    recovery.instance.openModal(path);
}

export async function findInFiles(app, file, document) {
    if (!app.internalPlugins?.plugins?.["global-search"]?.enabled) throw new ModuleUnavailableError("project", "Enable Search to find text in files.");
    if (document !== app.workspace.containerEl.ownerDocument) throw new ModuleUnavailableError("project", "This window has no native Search sidebar.");
    const leaf = app.workspace.getLeavesOfType("search")[0] ?? await app.workspace.ensureSideLeaf("search", "left", { reveal: false });
    await leaf.setViewState({ type: "search", active: true });
    if (typeof leaf.view.setQuery !== "function") throw new ModuleUnavailableError("project", "The native Search query interface is unavailable.");
    await app.workspace.revealLeaf(leaf);
    const scope = file instanceof TFolder ? (!file.parent ? "" : `path:${JSON.stringify(`${file.path}/`)} `)
        : `path:/^${file.path.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}$/ `;
    leaf.view.setQuery(scope);
    const input = leaf.view.containerEl.querySelector('input[type="search"]');
    input?.focus(); input?.setSelectionRange(scope.length, scope.length);
}
