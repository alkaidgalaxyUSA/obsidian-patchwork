import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { stagePaths } from "./stage-paths";
import { equalDiffContent } from "./equal-diff-content";

/** Compare a revision with local bytes, including files no longer tracked by HEAD. */
export async function revisionLocalDiff(repository, revision, path, isCurrent) {
    const entry = await repository.run(["ls-tree", "-z", revision, "--", path]);
    if (!isCurrent()) return;
    const blob = /^(100644|100755) blob ([a-f0-9]+)\t/.exec(entry);
    if (blob) {
        const before = await repository.run(["cat-file", "blob", blob[2]], { encoding: "buffer" });
        if (!isCurrent()) return;
        const after = await readFile(join(repository.root, path));
        if (!isCurrent()) return;
        const equal = equalDiffContent(path, before, after);
        if (equal) return { text: "", ...equal };
    }
    const directory = await mkdtemp(join(repository.gitDir, "patchwork-local-diff-"));
    const env = { GIT_INDEX_FILE: join(directory, "index") };
    try {
        if (!isCurrent()) return;
        await repository.run(["read-tree", revision], { env });
        if (!isCurrent()) return;
        await stagePaths(repository, [path], { env });
        if (!isCurrent()) return;
        const text = await repository.run(["diff", "--cached", "--no-ext-diff", "--no-textconv", "--no-color", "-U99999", revision, "--", path], { env });
        return { text };
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
}
