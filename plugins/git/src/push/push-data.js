import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";

const config = (repo, key) => repo.run(["config", "--get", key], { allowedExitCodes: [1] }).then(value => value.trim());
const refName = value => value.replace(/^refs\/heads\//, "");

export async function defaultPushTarget(repo, requestedBranch) {
    const snapshot = await repo.snapshot();
    const branch = requestedBranch || (snapshot.local.includes(snapshot.current) ? snapshot.current : undefined);
    const sourceRef = branch ? `refs/heads/${branch}` : "HEAD";
    const trackingRemote = branch ? await config(repo, `branch.${branch}.remote`) : "";
    const preferred = branch ? await config(repo, `branch.${branch}.pushRemote`) : "";
    const remoteDefault = await config(repo, "remote.pushDefault");
    const remote = [preferred, remoteDefault, trackingRemote, "origin", ...snapshot.remotes].find(name => snapshot.remotes.includes(name)) || "";
    let target = branch || "detached";
    if (remote) {
        const specs = (await repo.run(["config", "--get-all", `remote.${remote}.push`], { allowedExitCodes: [1] })).trim().split("\n");
        let wildcard, matched = false;
        for (const spec of specs) {
            const [from, to] = spec.replace(/^\+/, "").split(":");
            if (!to) continue;
            if ([branch, sourceRef, "HEAD"].includes(from)) { target = refName(to); wildcard = undefined; matched = true; break; }
            if (from.endsWith("*") && to.endsWith("*") && sourceRef.startsWith(from.slice(0, -1))) wildcard ??= refName(to.slice(0, -1) + sourceRef.slice(from.length - 1));
        }
        if (wildcard) target = wildcard;
        else if (!matched && target === branch && trackingRemote === remote) target = refName(await config(repo, `branch.${branch}.merge`) || target);
    }
    return { branch, sourceRef, remote, target, remotes: snapshot.remotes, tracking: snapshot.upstreams.get(branch), snapshot };
}

export async function readPushPlan(repo, destination, signal, limit = 200, verifyRemote = true) {
    const { remote, target, sourceRef } = destination;
    if (!remote || remote.startsWith("-") || !(await repo.snapshot()).remotes.includes(remote)) throw new Error("Select a configured remote.");
    await repo.run(["check-ref-format", `refs/heads/${target}`], { signal });
    const pushUrls = (await repo.run(["remote", "get-url", "--push", "--all", remote], { signal })).trim().split(/\r?\n/);
    const pushUrl = destination.pushEndpoint || pushUrls[0];
    if (!pushUrls.includes(pushUrl)) throw new Error("This push destination was removed from the remote configuration. Reopen Push.");
    const checkedOut = await repo.branch();
    const source = (await repo.run(["rev-parse", "--verify", `${sourceRef}^{commit}`], { signal, allowedExitCodes: [128] })).trim();
    if (!/^[a-f0-9]{40,64}$/.test(source)) throw new Error("The push source has no commit. Create a commit or select an existing branch first.");
    const localRef = `refs/remotes/${remote}/${target}`;
    const cached = (await repo.run(["rev-parse", "--verify", localRef], { signal, allowedExitCodes: [128] })).trim();
    let remoteError, tip, verified = false;
    try {
        if (!verifyRemote) tip = /^[a-f0-9]{40,64}$/.test(cached) ? cached : undefined;
        else {
        const listing = await repo.run(["ls-remote", "--heads", "--", pushUrl, `refs/heads/${target}`], { signal, timeout: 30000 });
        tip = listing.split(/\r?\n/).find(line => line.split("\t")[1] === `refs/heads/${target}`)?.split("\t")[0];
        verified = true;
        }
    } catch (error) { signal?.throwIfAborted(); remoteError = error.message; tip = /^[a-f0-9]{40,64}$/.test(cached) ? cached : undefined; }
    let needsFetch = false;
    if (tip) {
        try { await repo.run(["cat-file", "-e", `${tip}^{commit}`], { signal }); }
        catch { signal?.throwIfAborted(); needsFetch = true; }
    }
    const base = needsFetch ? (/^[a-f0-9]{40,64}$/.test(cached) ? cached : undefined) : tip;
    let range = base ? [`${base}..${source}`] : [source, "--not", `--remotes=${remote}`];
    let remoteRefs = [], revisionInput;
    if (verified && !tip) {
        const advertised = await repo.run(["ls-remote", "--heads", "--", pushUrl], { signal, timeout: 30000 });
        remoteRefs = advertised.trim().split(/\r?\n/).filter(Boolean).map(line => { const [hash, ref] = line.split("\t"); return { hash, ref }; });
        revisionInput = [source, ...new Set(remoteRefs.map(item => `^${item.hash}`))].join("\n") + "\n";
        range = ["--stdin"];
    }
    let count;
    try { count = Number((await repo.run(["rev-list", "--count", ...range], { signal, input: revisionInput })).trim()); }
    catch (error) {
        signal?.throwIfAborted();
        if (!remoteRefs.length) throw error;
        needsFetch = true; range = [source]; revisionInput = undefined;
        count = Number((await repo.run(["rev-list", "--count", source], { signal })).trim());
    }
    const raw = await repo.run(["log", `-${limit}`, "--topo-order", "--format=%H%x00%P%x00%an%x00%aI%x00%B%x00", ...range, "--"], { signal, input: revisionInput });
    const fields = raw.split("\0"), commits = [];
    for (let i = 0; i + 4 < fields.length; i += 5) {
        const hash = fields[i].trim();
        if (!hash) continue;
        const message = fields[i + 4].trimEnd();
        commits.push({ hash, parents: fields[i + 1].split(" ").filter(Boolean), author: fields[i + 2], date: fields[i + 3], message, subject: message.split("\n")[0] });
    }
    const incoming = tip && !needsFetch ? Number((await repo.run(["rev-list", "--count", `${source}..${tip}`], { signal })).trim()) : undefined;
    return { ...destination, source, tip, pushUrl, remoteRefs, pushConfiguration: pushUrls.join("\n"), multipleEndpoints: pushUrls.length > 1,
        checkedOut, verified, remoteError, needsFetch, count, incoming, commits, limit, isNew: verified && !tip };
}

/** Fetch only missing preview objects from the reviewed push endpoint, without changing local branches. */
export async function fetchPushPlanObjects(repo, plan, signal) {
    signal?.throwIfAborted();
    if (!plan.verified || !plan.needsFetch) return;
    const urls = (await repo.run(["remote", "get-url", "--push", "--all", plan.remote], { signal })).trim();
    if (urls !== plan.pushConfiguration) throw new Error("The push configuration changed. Reopen Push.");
    const refs = plan.isNew ? plan.remoteRefs.map(item => item.ref) : [`refs/heads/${plan.target}`];
    for (let offset = 0; offset < refs.length; offset += 100) {
        signal?.throwIfAborted();
        await repo.run(["fetch", "--no-tags", "--no-prune", "--no-write-fetch-head", "--refmap=", "--", plan.pushUrl, ...refs.slice(offset, offset + 100)], { signal });
    }
}

/** Preserve blob identity when joining changes, including rename chains and gaps in selection. */
export async function collectPushChanges(repo, commits, signal) {
    const chains = [];
    for (const commit of [...commits].reverse()) {
        const parent = commit.parents[0];
        const args = parent ? ["diff", parent, commit.hash] : ["diff-tree", "--root", "--no-commit-id", "-r", commit.hash];
        const records = (await repo.run([...args, "--raw", "--no-ext-diff", "--no-textconv", "--abbrev=64", "-M", "-z", "--"], { signal })).split("\0");
        for (let i = 0; records[i];) {
            const [oldMode, newMode, before, after, status] = records[i++].slice(1).split(" ");
            const original = records[i++];
            const path = /^[RC]/.test(status) ? records[i++] : original;
            const left = /^0+$/.test(before) ? undefined : { hash: before, mode: oldMode, path: original, revision: parent };
            const right = /^0+$/.test(after) ? undefined : { hash: after, mode: newMode, path, revision: commit.hash };
            const previous = [...chains].reverse().find(change => change.right && left && change.right.path === left.path && change.right.hash === left.hash && change.right.mode === left.mode);
            if (previous) previous.right = right;
            else chains.push({ left, right, order: chains.length });
        }
    }
    return chains.filter(change => (change.left || change.right) && !(change.left && change.right && change.left.path === change.right.path && change.left.hash === change.right.hash && change.left.mode === change.right.mode))
        .map(change => ({ ...change, path: (change.right || change.left).path, original: change.left?.path,
            status: !change.left ? "A" : !change.right ? "D" : change.left.path !== change.right.path ? "R" : "M",
            parentHash: `change-${change.order}`, additions: 0, deletions: 0 }));
}

/** Build an exact per-file comparison without consulting or changing the real index. */
export async function pushChangeDiff(repo, change, signal) {
    const directory = await mkdtemp(join(repo.gitDir, "patchwork-push-diff-"));
    const env = { GIT_INDEX_FILE: join(directory, "index") };
    try {
        const trees = [];
        for (const side of [change.left, change.right]) {
            await repo.run(["read-tree", "--empty"], { env, signal });
            if (side) await repo.run(["update-index", "--add", "--cacheinfo", side.mode, side.hash, side.path], { env, signal });
            trees.push((await repo.run(["write-tree"], { env, signal })).trim());
        }
        return await repo.run(["-c", "core.quotepath=false", "diff", "--no-ext-diff", "--no-textconv", "--no-color", "--full-index", "-M", "-U100000", ...trees, "--"], { signal });
    } finally { await rm(directory, { recursive: true, force: true }); }
}
