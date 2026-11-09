import { runPathspecCommand } from "./pathspec-command.js";

/** Update tracked files even when their parent is ignored; never force-add ignored files. */
export async function stagePaths(repository, paths, options = {}) {
    if (!paths.length) return;
    const cached = new Set((await repository.run(["ls-files", "--cached", "-z"], options)).split("\0").filter(Boolean));
    const tracked = paths.filter(path => cached.has(path));
    const added = paths.filter(path => !cached.has(path));
    await runPathspecCommand(repository, ["add", "--update"], tracked, options);
    await runPathspecCommand(repository, ["add", "--all"], added, options);
}
