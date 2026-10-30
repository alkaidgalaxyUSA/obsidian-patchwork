import { execFile } from "node:child_process";
import { access, copyFile, mkdtemp, open, readFile, rename, rm } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { Shelves } from "./shelves.js";

/** Native Git backend; paths are literal and commands never pass through a shell. */
export class Repository {
    constructor(vaultPath) {
        this.vaultPath = vaultPath;
        this.root = vaultPath;
        this.children = new Set();
        this.queue = Promise.resolve();
        this.shelves = new Shelves(this);
    }

    run(args, options = {}) {
        if (this.disposed) return Promise.reject(new Error("Git plugin has been unloaded."));
        const { allowedExitCodes = [], ...processOptions } = options;
        return new Promise((resolveResult, reject) => {
            const child = execFile("git", ["--no-pager", ...args], {
                cwd: this.root, windowsHide: true, timeout: 120000, maxBuffer: 32 * 1024 * 1024,
                encoding: "utf8", ...processOptions,
                env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_LITERAL_PATHSPECS: "1", GIT_OPTIONAL_LOCKS: "0", ...options.env },
            }, (error, stdout, stderr) => {
                this.children.delete(child);
                if (error && !allowedExitCodes.includes(error.code)) reject(new Error(String(stderr?.length ? stderr : error.message).trim()));
                else resolveResult(stdout);
            });
            this.children.add(child);
        });
    }

    mutate(action) {
        const operation = this.queue.then(() => {
            if (this.disposed || this.closing) throw new Error("Git plugin has been unloaded.");
            return action();
        });
        this.queue = operation.catch(() => {});
        return operation;
    }

    async discover() {
        this.root = this.vaultPath;
        this.root = (await this.run(["rev-parse", "--show-toplevel"])).trim();
        this.gitDir = (await this.run(["rev-parse", "--absolute-git-dir"])).trim();
        this.indexPath = resolve(this.root, (await this.run(["rev-parse", "--git-path", "index"])).trim());
    }

    path(vaultRelative) {
        const path = relative(this.root, resolve(this.vaultPath, vaultRelative === "/" ? "." : vaultRelative)).replaceAll("\\", "/");
        if (path === ".." || path.startsWith("../") || isAbsolute(path)) throw new Error("The file is outside this repository.");
        return path || ".";
    }

    async head() {
        try { return (await this.run(["rev-parse", "--verify", "HEAD"])).trim(); }
        catch { return undefined; }
    }

    async branch() {
        try { return (await this.run(["symbolic-ref", "--quiet", "--short", "HEAD"])).trim(); }
        catch { return `Detached ${(await this.run(["rev-parse", "--short", "HEAD"])).trim()}`; }
    }

    async status() {
        const raw = await this.run(["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
        const parts = raw.split("\0");
        const entries = [];
        for (let index = 0; index < parts.length; index++) {
            const record = parts[index];
            if (!record) continue;
            const code = record.slice(0, 2);
            const path = record.slice(3);
            const original = /[RC]/.test(code) ? parts[++index] : undefined;
            const untracked = code === "??";
            entries.push({ path, original, code, untracked, staged: !untracked && code[0] !== " ",
                conflict: ["DD", "AU", "UD", "UA", "DU", "AA", "UU"].includes(code) });
        }
        return entries;
    }

    async snapshot() {
        const [local, current, remote, log, tags] = await Promise.all([
            this.run(["for-each-ref", "--format=%(refname:short)%09%(upstream:short)", "refs/heads"]),
            this.branch(), this.run(["for-each-ref", "--format=%(refname:short)", "refs/remotes"]),
            this.run(["reflog", "--format=%gs", "-n", "40"]).catch(() => ""), this.run(["tag", "--list"]),
        ]);
        const upstreams = new Map(local.trim().split(/\r?\n/).filter(Boolean).map(line => line.split("\t")));
        const branches = [...upstreams.keys()];
        const visited = log.split(/\r?\n/).flatMap(line => {
            const match = line.match(/^checkout: moving from (.+) to (.+)$/);
            return match ? [match[2], match[1]] : [];
        });
        return { current, upstreams, local: branches,
            recent: [...new Set([current, ...visited])].filter(ref => branches.includes(ref)).slice(0, 8),
            remote: remote.trim().split(/\r?\n/).filter(ref => ref && !ref.endsWith("/HEAD")),
            tags: tags.trim().split(/\r?\n/).filter(Boolean), remoteError: false, tagsError: false };
    }

    async messages() {
        if (!await this.head()) return [];
        const output = await this.run(["log", "-50", "--format=%B%x00"]);
        return [...new Set(output.split("\0").map(message => message.trim()).filter(Boolean))];
    }

    async expandRenames(paths) {
        const entries = await this.status();
        const originals = entries.filter(entry => entry.code.includes("R") && paths.some(path => path === "." || entry.path === path || entry.path.startsWith(`${path}/`)))
            .map(entry => entry.original).filter(Boolean);
        return [...new Set([...paths, ...originals])];
    }

    async stage(paths) { await this.run(["add", "--all", "--", ...await this.expandRenames(paths)]); }

    async unstage(paths) {
        paths = await this.expandRenames(paths);
        if (await this.head()) await this.run(["reset", "--quiet", "HEAD", "--", ...paths]);
        else await this.run(["rm", "--cached", "--ignore-unmatch", "-r", "--", ...paths]);
    }

    async checkout(ref, remote = false) {
        if (!ref || ref.startsWith("-") || /[\s\x00-\x1f]/.test(ref)) throw new Error("Enter a valid branch, tag, or revision.");
        if (remote) await this.run(["switch", "--track", ref]);
        else await this.run(["checkout", ref, "--"]);
    }

    /** Commit a working-tree selection using a private index; keep unrelated staging intact. */
    async commit(selected, message, amend) {
        if (!message.trim()) throw new Error("Enter a commit message.");
        const entries = await this.status();
        if (entries.some(entry => entry.conflict)) throw new Error("Resolve all merge conflicts before committing.");
        const chosen = entries.filter(entry => selected.has(entry.path));
        if (!chosen.length && !amend) throw new Error("Select at least one changed file.");
        const before = await this.head();
        if (amend && !before) throw new Error("There is no commit to amend.");
        // Partial commits during merge/rebase/cherry-pick would corrupt operation semantics.
        for (const state of ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-merge", "rebase-apply"]) {
            const location = resolve(this.root, (await this.run(["rev-parse", "--git-path", state])).trim());
            try { await access(location); }
            catch (error) { if (error.code === "ENOENT") continue; throw error; }
            throw new Error("Finish the active merge, rebase, or cherry-pick before committing here.");
        }
        const paths = [...new Set(chosen.flatMap(entry => [entry.path, entry.code.includes("R") ? entry.original : undefined].filter(Boolean)))];
        const directory = await mkdtemp(join(this.gitDir, "patchwork-commit-"));
        const privateIndex = join(directory, "selected-index");
        const preservedIndex = join(directory, "preserved-index");
        const lockPath = `${this.indexPath}.lock`;
        let lock;
        let committed = false;
        try {
            lock = await open(lockPath, "wx");
            const env = { GIT_INDEX_FILE: privateIndex };
            if (before) await this.run(["read-tree", before], { env });
            else await this.run(["read-tree", "--empty"], { env });
            try { await copyFile(this.indexPath, preservedIndex); }
            catch (error) {
                if (error.code !== "ENOENT") throw error;
                await this.run(["read-tree", "--empty"], { env: { GIT_INDEX_FILE: preservedIndex } });
            }
            if (paths.length) await this.run(["add", "--all", "--", ...paths], { env });
            if (await this.head() !== before) throw new Error("HEAD changed. Refresh the selection and try again.");
            await this.run(["commit", ...(amend ? ["--amend"] : []), "-m", message], { env });
            committed = true;
            if (paths.length) await this.run(["reset", "--quiet", "HEAD", "--", ...paths], { env: { GIT_INDEX_FILE: preservedIndex } });
            await lock.writeFile(await readFile(preservedIndex));
            await lock.close();
            await rename(lockPath, this.indexPath);
            lock = undefined;
            return { committed: true };
        } catch (error) {
            if (committed) return { committed: true, warning: `Commit created, but the index could not be refreshed: ${error.message}. Refresh Git before further operations.` };
            throw error;
        } finally {
            // Cleanup must not turn a successful commit into a reported failure.
            if (lock) {
                await lock.close().catch(() => {});
                await rm(lockPath, { force: true }).catch(error => console.error("Patchwork Git index-lock cleanup failed", error));
            }
            await rm(directory, { recursive: true, force: true }).catch(error => console.error("Patchwork Git temporary-index cleanup failed", error));
        }
    }

    dispose() {
        this.closing = true;
        // Let an in-flight mutation reconcile its index before stopping processes.
        void this.queue.finally(() => {
            this.disposed = true;
            for (const child of this.children) child.kill();
            this.children.clear();
        });
    }
}
