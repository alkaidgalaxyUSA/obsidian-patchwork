/** Parse NUL-separated records without interpreting paths or commit text. */
export function parseLog(raw) {
    const fields = raw.split("\0");
    const commits = [];
    for (let index = 0; index + 5 < fields.length; index += 6) {
        const [hash, parents, author, date, refs, subject] = fields.slice(index, index + 6);
        if (!/^[a-f0-9]{40,64}$/.test(hash)) continue;
        commits.push({ hash, parents: parents.split(" ").filter(Boolean), author, date, refs, subject });
    }
    return commits;
}

export function parseChanges(raw) {
    const fields = raw.split("\0");
    const changes = [];
    for (let index = 0; index < fields.length && fields[index];) {
        const status = fields[index++];
        const first = fields[index++];
        const renamed = /^[RC]/.test(status);
        const path = renamed ? fields[index++] : first;
        if (path) changes.push({ status, path, original: renamed ? first : undefined });
    }
    return changes;
}

export async function readLog(repository, filter, limit) {
    if (!await repository.head()) return [];
    const args = ["log", "-z", "--topo-order", `--max-count=${limit}`, "--format=%H%x00%P%x00%an%x00%aI%x00%D%x00%s"];
    if (filter.author) args.push(`--author=${filter.author}`);
    if (filter.since) args.push(`--since=${filter.since}`);
    if (!filter.regex) args.push("--fixed-strings");
    if (!filter.caseSensitive) args.push("--regexp-ignore-case");
    let hash;
    if (/^[a-f\d]{7,64}$/i.test(filter.search)) {
        try { hash = (await repository.run(["rev-parse", "--verify", "--end-of-options", `${filter.search}^{commit}`])).trim(); }
        catch { /* A hexadecimal search may also be ordinary commit text. */ }
    }
    if (filter.search && !hash) args.push(`--grep=${filter.search}`);
    if (hash) args.push("--no-walk", "--end-of-options", hash);
    else if (filter.ref) args.push("--end-of-options", filter.ref);
    else args.push("--all");
    args.push("--");
    if (filter.path) args.push(filter.path);
    return parseLog(await repository.run(args));
}

/** Each lane tracks an actual parent hash; merge edges join the matching lane. */
export function layoutGraph(commits) {
    let lanes = [];
    return commits.map(commit => {
        if (!lanes.includes(commit.hash)) lanes.push(commit.hash);
        const before = [...lanes];
        const column = lanes.indexOf(commit.hash);
        lanes.splice(column, 1);
        commit.parents.forEach((parent, index) => {
            if (!lanes.includes(parent)) lanes.splice(Math.min(column + index, lanes.length), 0, parent);
        });
        const edges = before.flatMap((hash, from) => hash === commit.hash ? [] : [{ from, to: lanes.indexOf(hash), through: true }]);
        edges.push(...commit.parents.map(hash => ({ from: column, to: lanes.indexOf(hash), through: false })));
        return { column, before: before.length, after: lanes.length, edges };
    });
}

export async function readCommit(repository, commit) {
    const args = commit.parents.length
        ? ["diff", "--name-status", "-z", "--find-renames", commit.parents[0], commit.hash, "--"]
        : ["diff-tree", "--root", "--no-commit-id", "--name-status", "-r", "-z", commit.hash, "--"];
    const [raw, message] = await Promise.all([
        repository.run(args), repository.run(["show", "-s", "--format=%B", commit.hash, "--"]),
    ]);
    return { files: parseChanges(raw), message: message.trimEnd() };
}

export function readCommitDiff(repository, commit, file) {
    const flags = ["--no-ext-diff", "--no-textconv", "--no-color", "--find-renames"];
    const args = commit.parents.length
        ? ["diff", ...flags, commit.parents[0], commit.hash, "--"]
        : ["show", "--format=", ...flags, commit.hash, "--"];
    args.push(...[file.original, file.path].filter(Boolean));
    return repository.run(args);
}
