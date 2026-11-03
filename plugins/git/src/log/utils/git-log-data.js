import { createGraphRows } from "../../history/utils/graph-rows";

/** Adapt the headless History model to the established Log row model. */
export async function readLog(history, filter, limit, skip = 0) {
    const commits = await history.log({ maxCount: limit, branch: filter.ref || undefined, all: !filter.ref,
        search: filter.search, author: filter.author, since: filter.since, regex: filter.regex,
        caseSensitive: filter.caseSensitive, order: filter.order, skip, paths: filter.paths?.length ? filter.paths : filter.path ? [filter.path] : [] });
    return commits.map(commit => ({ ...commit, history: commit, subject: commit.message,
        fullMessage: commit.message + (commit.body ? "\n\n" + commit.body : ""), refs: commit.refsText ?? "" }));
}

export function layoutGraph(commits) { return createGraphRows(commits.map(commit => commit.history)); }

export async function readCommit(history, commit) {
    const [files, branches] = await Promise.all([history.files(commit.hash), history.git.branchesContaining(commit.hash)]);
    return { files, branches, message: commit.fullMessage };
}

export function readCommitDiff(history, commit, file) {
    return history.git.diffCommitAgainstParent(commit.hash, [file.original, file.path].filter(Boolean));
}
