import { withWorktreeIndex } from "./worktree-renames";

/** Share working-tree comparison semantics between the dialog and explicit diff tabs. */
export async function workingDiff(controller, requestedPaths, staged, fullContext, baseline) {
    const repository = controller.repository;
    const git = controller.plugin.history.git;
    const entries = await repository.status();
    const unborn = baseline === "head" && !staged && !await repository.head();
    const selected = entries.filter(entry => requestedPaths.some(path => path === "." || entry.path === path || entry.path.startsWith(path + "/") || entry.original === path));
    const paths = [...new Set([...requestedPaths, ...selected.flatMap(entry => [entry.path, entry.original].filter(Boolean))])];
    const moved = !staged && selected.some(entry => entry.worktreeRename);
    if (moved) return withWorktreeIndex(repository, paths, (env, indexBaseline) => repository.run([
        "diff", "--cached", "--no-ext-diff", "--no-textconv", "--no-color", "-M", ...(fullContext ? ["-U99999"] : []), baseline === "head" ? "HEAD" : indexBaseline, "--", ...paths,
    ], { env }));
    let text = unborn ? "" : await git.diff(paths, staged, !!fullContext, baseline);
    if (!staged) for (const entry of selected.filter(entry => entry.untracked || unborn && !entry.code.includes("D"))) {
        text += await git.diffUntracked(entry.path, !!fullContext);
    }
    return text;
}
