import { createGraphRows } from "../../history/utils/graph-rows";

/** Adapt the headless History model to the established Log row model. */
export async function readLog(history, filter, limit, skip = 0) {
    const commits = await history.log({ maxCount: limit, branch: filter.ref || undefined, all: !filter.ref,
        search: filter.search, author: filter.author, since: filter.since, regex: filter.regex,
        follow: filter.fileHistory === true, caseSensitive: filter.caseSensitive, order: filter.order,
        firstParent: filter.firstParent === true, noMerges: filter.noMerges === true, skip,
        paths: filter.paths?.length ? filter.paths : filter.path ? [filter.path] : [] });
    return commits.map(commit => ({ ...commit, history: commit, subject: commit.message,
        fullMessage: commit.message + (commit.body ? "\n\n" + commit.body : ""), refs: commit.refsText ?? "" }));
}

export function layoutGraph(commits, order = "topo") { return createGraphRows(commits.map(commit => commit.history), order !== "date"); }

export async function readCommit(history, commit, signal) {
    const git = history.git;
    const [groups, branches] = await Promise.all([
        Promise.all((commit.parents.length ? commit.parents : [undefined]).map(async parent => {
            const files = await git.showCommitFiles(commit.hash, parent, signal);
            return files.map(file => ({ ...file, parentHash: parent }));
        })), git.branchesContaining(commit.hash, signal),
    ]);
    signal?.throwIfAborted();
    const files = groups.flat();
    return { files, branches, message: commit.fullMessage };
}

export function readCommitDiff(history, commit, file) {
    return history.git.diffCommitAgainstParent(commit.hash, [file.original, file.path].filter(Boolean));
}
