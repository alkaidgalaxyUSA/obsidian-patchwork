import { mkdtemp, open, rm } from "node:fs/promises";
import { join } from "node:path";

/** Keep selected paths literal without exceeding the operating system's argument limit. */
export async function runPathspecCommand(repository, args, paths, options = {}) {
    if (!paths.length) return;
    const directory = await mkdtemp(join(repository.gitDir, "patchwork-pathspec-"));
    const pathspec = join(directory, "paths");
    try {
        const handle = await open(pathspec, "wx");
        try { await handle.writeFile(`${paths.join("\0")}\0`, "utf8"); }
        finally { await handle.close(); }
        return await repository.run([...args, `--pathspec-from-file=${pathspec}`, "--pathspec-file-nul"], options);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
}
