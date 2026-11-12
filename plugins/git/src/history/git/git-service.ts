/*! Adapted from Obsidian Git History 1.13.0. Copyright (c) 2025 Chris Oguntolu. MIT License. */
import { execFile, processEnv, readFile, writeFile } from "../utils/node-api";
import type { GitCommandEnvironment } from "./environment";
import { pathsFor } from "./change-paths";
import type { ChangeSide } from "./change-paths";
import { parseIdentity } from "./git-identity";
import type { GitIdentity } from "./git-identity";
import {
  HistoryLogOptions,
  CommitFileInfo,
  FileStatus,
  FileStatusCode,
  CommitInfo,
  CommitStats,
  RefInfo,
  BranchInfo,
  RemoteInfo,
  FileDiff,
  DiffHunk,
  StashEntry,
  UpstreamState,
} from "../types";

/**
 * Running `git` by bare name, the way this used to work.
 *
 * Kept as the default so a GitService can still be built with nothing but a
 * path — the tests do, and they want the git on their own PATH. The plugin
 * hands in an ExecEnvironment instead, which resolves a git that has answered
 * for itself and gives it the login shell's PATH.
 */
const BARE_GIT: GitCommandEnvironment = {
  git: () => Promise.resolve({ binary: { path: "git", source: "path" }, tried: ["git"] }),
  env: (extra = {}) => Promise.resolve({ ...processEnv(), ...extra }),
};

export class GitService {
  private repoPath: string;
  private queue: Promise<unknown> = Promise.resolve();
  private disposed = false;
  private children = new Set<ReturnType<typeof execFile>>();
  coordinate: <T>(action: () => Promise<T>) => Promise<T> = action => action();
  dispose(): void { this.disposed = true; for (const child of this.children) child.kill(); this.children.clear(); }
  applyPatch(patch: string, staged: boolean): Promise<string> { return this.enqueue(() => this.exec(["apply", ...(staged ? ["--cached"] : ["-R"]), "-"], 30000, patch)); }
  applyHunk(patch: string, action: "stage" | "unstage" | "revert", path: string, expected: string): Promise<string> {
    return this.enqueue(async () => {
      const current = await this.diff([path], action === "unstage");
      if (current !== expected) throw new Error("This file changed since the diff was opened. Refresh the diff and try again.");
      return this.exec(["apply", ...(action === "revert" ? [] : ["--cached"]), ...(action === "stage" ? [] : ["--reverse"]), "-"], 30000, patch);
    });
  }
  private supportsDiffMerges = true;
  /** `git config --show-scope` needs git >= 2.26. Turned off for the session
      the first time a git says it does not know the option. */
  private supportsConfigScope = true;
  /** `--pathspec-from-file` needs git >= 2.25. Turned off for the session the
      first time a git says it does not know the option. */
  private supportsPathspecFile = true;

  constructor(
    repoPath: string,
    private environment: GitCommandEnvironment = BARE_GIT,
  ) {
    this.repoPath = repoPath;
  }

  setRepoPath(path: string): void {
    this.repoPath = path;
  }

  /**
   * Which git to run and what to run it with.
   *
   * A resolution that found nothing still falls back to the bare name: the
   * plugin has nothing better to offer at that point, and git's own error is a
   * more useful thing to show than a refusal to try.
   */
  private async command(): Promise<{ file: string; env: Record<string, string | undefined> }> {
    const [resolved, env] = await Promise.all([
      this.environment.git(),
      this.environment.env({ GIT_TERMINAL_PROMPT: "0" }),
    ]);
    return { file: resolved.binary?.path ?? "git", env };
  }

  private async exec(args: string[], timeout = 30000, input?: string, signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted();
    if (this.disposed) throw new Error("Git history has been unloaded.");
    const repoPath = this.repoPath;
    const { file, env } = await this.command();
    signal?.throwIfAborted();
    if (this.disposed) throw new Error("Git history has been unloaded.");
    return new Promise((resolve, reject) => {
      const child = execFile(
        file,
        // Without this git renders any path outside ASCII as an octal escape
        // inside double quotes — `"Studies/00 \342\200\224 Welcome.md"` for a
        // name holding an em dash. Every path git hands back would then have
        // to be unquoted before it could be opened, staged or diffed. The
        // commands reading NUL-separated output are unaffected by it either
        // way, so this is safe to set for all of them.
        ["--literal-pathspecs", "-c", "core.quotepath=false", ...args],
        {
          cwd: repoPath,
          windowsHide: true,
          maxBuffer: 50 * 1024 * 1024,
          timeout,
          signal,
          env,
        },
        (error, stdout, stderr) => {
          this.children.delete(child);
          if (error) {
            const msg = stderr?.trim() || error.message;
            reject(new GitError(msg, args, typeof error.code === "number" ? error.code : null));
            return;
          }
          resolve(stdout);
        },
      );
      this.children.add(child);
      if (input !== undefined && child.stdin) {
        // A git that exits before reading, such as one refusing an option,
        // closes the pipe under the write. Its exit code is the error that
        // matters; left unhandled, the broken pipe would crash the plugin.
        child.stdin.on("error", () => {});
        child.stdin.write(input);
        child.stdin.end();
      }
    });
  }

  /**
   * Runs a command whose failure is an answer.
   *
   * `git config --get` exits 1 when the key is not set and `--unset` exits 5
   * when there was nothing to remove — neither is a problem, and treating them
   * as one would turn "you have not set a name" into an error dialog.
   */
  private async execAllowing(codes: readonly number[], args: string[]): Promise<string> {
    try {
      return await this.exec(args);
    } catch (e: unknown) {
      if (e instanceof GitError && e.exitCode !== null && codes.includes(e.exitCode)) return "";
      throw e;
    }
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = () => { if (this.disposed) throw new Error("Git history has been unloaded."); return this.coordinate(fn); };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }

  /**
   * Whether the vault itself is a repository.
   *
   * Asking git alone answers a different question: `rev-parse` walks up the
   * directory tree, so a vault under a home directory that happens to be a
   * repository reports yes, and every command then runs against that outer
   * repository instead. The vault has to be the root for this to be its
   * history.
   */
  async isRepo(): Promise<boolean> {
    try {
      // `--show-prefix` is the vault's path relative to the repository root,
      // and empty exactly when the vault is that root. Git answers it itself,
      // which beats comparing paths: on macOS the vault may be reached through
      // a symlink git resolves away, and the filesystem may be case-folded.
      const prefix = await this.exec(["rev-parse", "--show-prefix"]);
      return prefix.trim() === "";
    } catch {
      return false;
    }
  }

  /**
   * Root of the repository the vault sits in, which may be an ancestor of the
   * vault or the vault itself. Null when there is no repository above it.
   */
  async enclosingRepoRoot(): Promise<string | null> {
    try {
      const out = (await this.exec(["rev-parse", "--show-toplevel"])).trim();
      return out === "" ? null : out;
    } catch {
      return null;
    }
  }

  async getRepoRoot(): Promise<string> {
    const out = await this.exec(["rev-parse", "--show-toplevel"]);
    return out.trim();
  }

  async status(): Promise<FileStatus[]> {
    // `-uall` lists untracked files individually instead of collapsing a whole
    // directory into one `dir/` entry, which is what the file tree needs to
    // show and what per-file staging needs to address. The only entries that
    // stay directories are nested repositories.
    const out = await this.exec(["status", "--porcelain=v2", "-z", "--untracked-files=all"]);
    return this.parseStatusV2(out);
  }

  private parseStatusV2(raw: string): FileStatus[] {
    const entries: FileStatus[] = [];
    const parts = raw.split("\0").filter(Boolean);
    let i = 0;
    while (i < parts.length) {
      const line = parts[i];
      if (line.startsWith("1 ")) {
        const fields = line.split(" ");
        const xy = fields[1];
        const path = fields.slice(8).join(" ");
        entries.push({
          path,
          indexStatus: xy[0] as FileStatusCode | " ",
          workingStatus: xy[1] as FileStatusCode | " ",
          staged: xy[0] !== "." && xy[0] !== "?" && xy[0] !== " ",
        });
      } else if (line.startsWith("2 ")) {
        const fields = line.split(" ");
        const xy = fields[1];
        const path = fields.slice(9).join(" ");
        const origPath = parts[++i];
        entries.push({
          path,
          originalPath: origPath,
          indexStatus: xy[0] as FileStatusCode | " ",
          workingStatus: xy[1] as FileStatusCode | " ",
          staged: xy[0] !== "." && xy[0] !== "?" && xy[0] !== " ",
        });
      } else if (line.startsWith("? ")) {
        const raw = line.substring(2);
        const path = raw.replace(/\/+$/, "");
        entries.push({
          path,
          indexStatus: " ",
          workingStatus: "?",
          staged: false,
          embeddedRepo: raw !== path,
        });
      } else if (line.startsWith("u ")) {
        const fields = line.split(" ");
        const path = fields.slice(10).join(" ");
        entries.push({
          path,
          indexStatus: "U",
          workingStatus: "U",
          staged: false,
        });
      }
      i++;
    }
    return entries;
  }

  /** Keeps argument lists below the OS limit where paths cannot go over stdin. */
  private static readonly PATHS_PER_CALL = 200;

  /** Stages the worktree half of each entry. */
  async stage(files: readonly FileStatus[]): Promise<void> {
    await this.withPaths(["add", "-A"], GitService.paths(files, "worktree"));
  }

  /**
   * Stages everything except nested repositories. A plain `git add -A` aborts
   * with "does not have a commit checked out" as soon as the vault contains an
   * embedded repo without commits, and then stages *nothing at all* — so the
   * entries are collected from status and the embedded repos are left out.
   * Returns the paths that were skipped so the caller can say so.
   */
  async stageAll(): Promise<{ skipped: string[] }> {
    const status = await this.status();
    const skipped = status.filter((f) => f.embeddedRepo).map((f) => f.path);
    if (skipped.length === 0) {
      await this.enqueue(() => this.exec(["add", "-A"]));
      return { skipped };
    }
    await this.stage(
      status
        .filter((f) => !f.embeddedRepo)
        // Entries whose worktree half is clean are already staged, and a staged
        // deletion matches neither the index nor the worktree — passing it as a
        // pathspec fails the whole call with "did not match any files".
        .filter((f) => f.workingStatus !== "." && f.workingStatus !== " "),
    );
    return { skipped };
  }

  /** Puts the index half of each entry back to what HEAD holds. */
  async unstage(files: readonly FileStatus[]): Promise<void> {
    await this.withPaths(["reset", "-q"], GitService.paths(files, "index"));
  }

  async unstageAll(): Promise<void> {
    await this.enqueue(() => this.exec(["reset", "HEAD"]));
  }

  /** Puts the worktree half of each entry back to what the index holds. */
  async discard(files: readonly FileStatus[]): Promise<void> {
    await this.withPaths(["checkout"], GitService.paths(files, "worktree"));
  }

  private static paths(files: readonly FileStatus[], side: ChangeSide): string[] {
    return files.flatMap((f) => pathsFor(f, side));
  }

  /**
   * Runs one command over exactly the given paths.
   *
   * `--literal-pathspecs` makes a path name that file and nothing else: read as
   * a pattern, `k[1].md` also matches `k1.md`, and staging one note staged its
   * neighbour. The paths go over stdin, so a whole vault is one call, and a
   * failure leaves the index as it was rather than changed up to some chunk.
   */
  private async withPaths(args: string[], paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    await this.enqueue(async () => {
      if (this.supportsPathspecFile) {
        try {
          const fromStdin = ["--pathspec-from-file=-", "--pathspec-file-nul"];
          await this.exec(["--literal-pathspecs", ...args, ...fromStdin], 30000, paths.join("\0"));
          return;
        } catch (e: unknown) {
          if (!GitService.refusedPathspecFile(e)) throw e;
          this.supportsPathspecFile = false;
        }
      }
      for (let i = 0; i < paths.length; i += GitService.PATHS_PER_CALL) {
        const chunk = paths.slice(i, i + GitService.PATHS_PER_CALL);
        await this.exec(["--literal-pathspecs", ...args, "--", ...chunk]);
      }
    });
  }

  /** Git answers an option it does not know with usage and exit code 129. */
  private static refusedPathspecFile(e: unknown): boolean {
    return e instanceof GitError && e.exitCode === 129 && e.message.includes("pathspec-from-file");
  }

  async discardAll(): Promise<void> {
    await this.enqueue(async () => {
      await this.exec(["checkout", "--", "."]);
      await this.exec(["clean", "-fd"]);
    });
  }

  async commit(message: string, opts?: { amend?: boolean; allowEmpty?: boolean }): Promise<void> {
    const args = ["commit", "-m", message];
    if (opts?.amend) args.push("--amend");
    if (opts?.allowEmpty) args.push("--allow-empty");
    await this.enqueue(() => this.exec(args));
  }

  async push(opts?: {
    remote?: string;
    branch?: string;
    force?: boolean;
    setUpstream?: boolean;
  }): Promise<void> {
    const args = ["push"];
    if (opts?.force) args.push("--force-with-lease");
    if (opts?.setUpstream) args.push("-u");
    if (opts?.remote) args.push(opts.remote);
    if (opts?.branch) args.push(opts.branch);
    await this.enqueue(() => this.exec(args, 60000));
  }

  async pull(opts?: {
    remote?: string;
    branch?: string;
    strategy?: "merge" | "rebase" | "ff-only";
  }): Promise<void> {
    const args = ["pull"];
    if (opts?.strategy === "rebase") args.push("--rebase");
    else if (opts?.strategy === "ff-only") args.push("--ff-only");
    if (opts?.remote) args.push(opts.remote);
    if (opts?.branch) args.push(opts.branch);
    await this.enqueue(() => this.exec(args, 60000));
  }

  async fetch(remote?: string): Promise<void> {
    const args = ["fetch"];
    if (remote) args.push(remote);
    else args.push("--all");
    await this.enqueue(() => this.exec(args, 60000));
  }

  async log(opts: HistoryLogOptions = {}): Promise<CommitInfo[]> {
    const args = ["log", "--no-ext-diff", "--no-textconv", "--no-color", "--parents", "--shortstat",
      "--format=%x00%H%x00%h%x00%P%x00%s%x00%b%x00%an%x00%ae%x00%aI%x00%D%x00",
      opts.order === "date" ? "--date-order" : "--topo-order"];
    if (this.supportsDiffMerges) args.push("--diff-merges=first-parent");
    if (opts.maxCount) args.push(`--max-count=${opts.maxCount}`);
    if (opts.skip) args.push(`--skip=${opts.skip}`);
    if (opts.order === "reverse") args.push("--reverse");
    if (opts.firstParent) args.push("--first-parent");
    if (opts.noMerges) args.push("--no-merges");
    if (opts.author) args.push(`--author=${opts.author}`);
    if (opts.since) args.push(`--since=${opts.since}`);
    if (!opts.regex) args.push("--fixed-strings");
    if (!opts.caseSensitive) args.push("--regexp-ignore-case");
    const paths = opts.paths ?? (opts.file ? [opts.file] : []);
    let hash: string | undefined;
    if (/^[a-f\d]{7,64}$/i.test(opts.search ?? "")) {
      try { hash = (await this.exec(["rev-parse", "--verify", "--end-of-options", `${opts.search}^{commit}`])).trim(); }
      catch { /* A hexadecimal query can also be message text. */ }
    }
    if (opts.search && !hash) args.push(`--grep=${opts.search}`);
    if (paths.length === 1 && opts.follow !== false) args.push("--follow");
    if (hash) args.push("--no-walk", "--end-of-options", hash);
    else if (opts.all) args.push("--all");
    else if (opts.branch) args.push("--end-of-options", opts.branch);
    args.push("--", ...paths);
    try { return this.parseLog(await this.exec(args)); }
    catch (error) {
      if (this.supportsDiffMerges && error instanceof GitError && /diff-merges/.test(error.message)) {
        this.supportsDiffMerges = false;
        return this.log(opts);
      }
      // An unborn repository has no history. Invalid filters and command failures
      // must remain visible instead of masquerading as an empty result.
      if (error instanceof GitError && /does not have any commits yet|bad default revision/.test(error.message)) return [];
      throw error;
    }
  }

  private parseLog(raw: string): CommitInfo[] {
    const fields = raw.split("\0");
    const commits: CommitInfo[] = [];
    // The leading NUL leaves an empty element at index 0. Each subsequent
    // commit contributes ten fields: nine metadata fields and its shortstat.
    for (let index = 1; index + 8 < fields.length; index += 10) {
      const [hash, shortHash, parents, message, body, author, authorEmail, date, refs] = fields.slice(index, index + 9);
      if (!/^[a-f\d]{40,64}$/.test(hash)) continue;
      commits.push({ hash, shortHash, parents: parents.split(" ").filter(Boolean), message, body: body.trim(), author, authorEmail,
        date: new Date(date), refsText: refs, refs: this.parseRefs(refs), stats: this.parseShortStat(fields[index + 9] ?? "") });
    }
    return commits;
  }

  /** Parses ` 4 files changed, 13 insertions(+), 3 deletions(-)` (both counts optional). */
  private parseShortStat(text: string): CommitStats | undefined {
    const match = text.match(
      /(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/,
    );
    if (!match) return undefined;
    return {
      filesChanged: parseInt(match[1]),
      additions: match[2] ? parseInt(match[2]) : 0,
      deletions: match[3] ? parseInt(match[3]) : 0,
    };
  }

  private parseRefs(refsStr: string): RefInfo[] {
    if (!refsStr) return [];
    return refsStr.split(", ").map((r) => {
      let name = r.trim();
      let type: RefInfo["type"] = "branch";
      let current = false;
      if (name.startsWith("HEAD -> ")) {
        name = name.substring(8);
        type = "head";
        current = true;
      } else if (name === "HEAD") {
        type = "head";
        current = true;
        return { name, type, current };
      }
      if (name.startsWith("tag: ")) {
        name = name.substring(5);
        type = "tag";
      } else if (name.includes("/")) {
        type = "remote";
      }
      return { name, type, current };
    });
  }

  async currentBranch(): Promise<string> {
    try {
      const out = await this.exec(["symbolic-ref", "--short", "HEAD"]);
      return out.trim();
    } catch {
      const out = await this.exec(["rev-parse", "--short", "HEAD"]);
      return `(${out.trim()})`;
    }
  }

  async branches(): Promise<BranchInfo[]> {
    const out = await this.exec([
      "branch",
      "-a",
      "-vv",
      "--format=%(refname:short)|%(HEAD)|%(upstream:short)|%(upstream:track,nobracket)",
    ]);
    const result: BranchInfo[] = [];
    for (const line of out.split("\n")) {
      if (!line.trim()) continue;
      const [name, head, tracking, trackInfo] = line.split("|");
      let ahead = 0;
      let behind = 0;
      if (trackInfo) {
        const aMatch = trackInfo.match(/ahead (\d+)/);
        const bMatch = trackInfo.match(/behind (\d+)/);
        if (aMatch) ahead = parseInt(aMatch[1]);
        if (bMatch) behind = parseInt(bMatch[1]);
      }
      const isRemote = name.includes("/");
      result.push({
        name,
        current: head === "*",
        remote: isRemote ? name.split("/")[0] : undefined,
        tracking: tracking || undefined,
        ahead,
        behind,
      });
    }
    return result;
  }

  async checkout(branch: string): Promise<void> {
    await this.enqueue(() => this.exec(["checkout", branch]));
  }

  async createBranch(name: string, from?: string): Promise<void> {
    const args = ["checkout", "-b", name];
    if (from) args.push(from);
    await this.enqueue(() => this.exec(args));
  }

  async deleteBranch(name: string, force = false): Promise<void> {
    await this.enqueue(() => this.exec(["branch", force ? "-D" : "-d", name]));
  }

  async merge(branch: string, opts?: { noFf?: boolean; squash?: boolean }): Promise<void> {
    const args = ["merge", branch];
    if (opts?.noFf) args.push("--no-ff");
    if (opts?.squash) args.push("--squash");
    await this.enqueue(() => this.exec(args));
  }

  async cherryPick(hash: string): Promise<void> {
    await this.enqueue(() => this.exec(["cherry-pick", hash]));
  }

  async revert(hash: string): Promise<void> {
    await this.enqueue(() => this.exec(["revert", "--no-edit", hash]));
  }

  async branchesContaining(hash: string, signal?: AbortSignal): Promise<string[]> {
    const refs = await this.exec(["for-each-ref", `--contains=${hash}`, "--format=%(refname)%09%(symref)", "refs/heads", "refs/remotes"], 30000, undefined, signal);
    const branches = refs.split(/\r?\n/).filter(Boolean).filter(line => !line.split("\t")[1])
      .map(line => line.split("\t")[0].replace(/^refs\/(heads|remotes)\//, ""));
    try { await this.exec(["merge-base", "--is-ancestor", hash, "HEAD"], 30000, undefined, signal); branches.unshift("HEAD"); }
    catch { /* Detached or unrelated HEAD is not a containing branch. */ }
    return branches;
  }

  async revertCommitFiles(hash: string, paths: string[]): Promise<void> {
    if (!/^[a-f\d]{40,64}$/i.test(hash) || !paths.length) throw new Error("Select committed files to revert.");
    await this.enqueue(async () => {
      const selected = new Set(paths);
      if ((await this.status()).some(file => selected.has(file.path) || !!file.originalPath && selected.has(file.originalPath)))
        throw new Error("Commit or shelve local changes to the selected files before reverting them.");
      // A binary patch also handles additions, deletions, mode changes and renames.
      const base = await this.hasParent(hash) ? ["diff", `${hash}^`, hash] : ["show", "--format=", hash];
      const patch = await this.exec(["--literal-pathspecs", ...base, "--binary", "--full-index", "--no-ext-diff", "--no-textconv", "--no-color", "-M", "--", ...selected]);
      if (!patch.trim()) throw new Error("No changes to revert in the selected files.");
      await this.exec(["apply", "--reverse", "--check", "-"], 30000, patch);
      await this.exec(["apply", "--reverse", "-"], 30000, patch);
    });
  }

  async restoreFile(ref: string, filePath: string): Promise<void> {
    await this.enqueue(async () => {
      if ((await this.status()).some(file => file.path === filePath || file.originalPath === filePath)) throw new Error("Commit or shelve local changes to this file before restoring it.");
      await this.exec(["--literal-pathspecs", "checkout", ref, "--", filePath]);
    });
  }

  async abortMerge(): Promise<void> {
    await this.enqueue(() => this.exec(["merge", "--abort"]));
  }

  /**
   * The diff of one entry, given the paths `pathsFor` names for it. A rename
   * has to be asked for with both of its paths: with the new one alone, git
   * compares it against nothing and reports the whole file as added. `-M`
   * turns rename detection on even where `diff.renames` is off.
   */
  async diff(paths: readonly string[], staged = false, fullContext = false, baseline: "index" | "head" = "index"): Promise<string> {
    const args = ["--literal-pathspecs", "diff", "--no-ext-diff", "--no-textconv", "--no-color", "-M"];
    if (fullContext) args.push("-U99999");
    if (staged) args.push("--cached");
    else if (baseline === "head") args.push("HEAD");
    args.push("--", ...paths);
    return this.exec(args);
  }

  async diffUntracked(path: string, fullContext = false): Promise<string> {
    const ctxArgs = fullContext ? ["-U99999"] : [];
    if (this.disposed) throw new Error("Git history has been unloaded.");
    const { file, env } = await this.command();
    if (this.disposed) throw new Error("Git history has been unloaded.");
    return new Promise((resolve) => {
      const child = execFile(
        file,
        ["--literal-pathspecs", "-c", "core.quotepath=false", "diff", "--no-index", "--no-ext-diff", "--no-textconv", "--no-color", ...ctxArgs, "--", "/dev/null", path],
        {
          cwd: this.repoPath,
          windowsHide: true,
          maxBuffer: 50 * 1024 * 1024,
          timeout: 30000,
          env,
        },
        (_error, stdout) => {
          this.children.delete(child);
          resolve(stdout || "");
        },
      );
      this.children.add(child);
    });
  }

  async diffCommit(
    ref1: string,
    ref2?: string,
    path?: string | string[],
    fullContext = false,
  ): Promise<string> {
    const args = ["--literal-pathspecs", "diff", "--no-ext-diff", "--no-textconv", "--no-color", "-M"];
    if (fullContext) args.push("-U99999");
    args.push(ref1);
    if (ref2) args.push(ref2);
    if (path) args.push("--", ...(Array.isArray(path) ? path : [path]));
    return this.exec(args);
  }

  /**
   * What a commit did to one file, against its first parent.
   *
   * A root commit has no parent, so `<ref>^` is not a revision and git fails
   * the whole diff — the first commit of a vault rendered as "No differences
   * found" for every file in it. `show` handles that case, printing the commit
   * as the additions it is.
   */
  async diffCommitAgainstParent(ref: string, path: string | string[], fullContext = false): Promise<string> {
    if (await this.hasParent(ref)) {
      return this.diffCommit(`${ref}^`, ref, path, fullContext);
    }
    const args = ["--literal-pathspecs", "show", "--no-ext-diff", "--no-textconv", "--no-color", "-M", "--format="];
    if (fullContext) args.push("-U99999");
    args.push(ref, "--", ...(Array.isArray(path) ? path : [path]));
    return this.exec(args);
  }

  private async hasParent(ref: string): Promise<boolean> {
    try {
      await this.exec(["rev-parse", "--verify", "--quiet", `${ref}^`]);
      return true;
    } catch {
      return false;
    }
  }

  async show(ref: string, path: string): Promise<string> {
    try {
      return await this.exec(["show", `${ref}:${path}`]);
    } catch {
      return "";
    }
  }

  async showCommitFiles(hash: string, parentHash?: string, signal?: AbortSignal): Promise<CommitFileInfo[]> {
    const parent = !!parentHash || await this.hasParent(hash);
    signal?.throwIfAborted();
    const command = parent ? ["diff", "--no-ext-diff", "--no-textconv", "--no-color"] : ["diff-tree", "--root", "--no-commit-id", "-r"];
    const flags = ["-M", "-z", ...(parent ? [parentHash || `${hash}^`, hash] : [hash]), "--"];
    const [names, stats] = await Promise.all([
      this.exec([...command, "--name-status", ...flags], 30000, undefined, signal),
      this.exec([...command, "--numstat", ...flags], 30000, undefined, signal),
    ]);
    const byPath = new Map<string, { additions: number; deletions: number; binary: boolean }>();
    const counts = stats.split("\0");
    for (let i = 0; i < counts.length && counts[i];) {
      const [add, del, ...parts] = counts[i++].split("\t");
      let path = parts.join("\t");
      if (!path) { i++; path = counts[i++]; }
      byPath.set(path, { additions: add === "-" ? 0 : Number(add), deletions: del === "-" ? 0 : Number(del), binary: add === "-" });
    }
    const records = names.split("\0"), files: CommitFileInfo[] = [];
    for (let i = 0; i < records.length && records[i];) {
      const status = records[i++], first = records[i++];
      const renamed = /^[RC]/.test(status);
      const path = renamed ? records[i++] : first;
      if (path) files.push({ path, status, original: renamed ? first : undefined,
        ...byPath.get(path) ?? { additions: 0, deletions: 0, binary: false } });
    }
    return files;
  }

  async parseDiff(raw: string): Promise<FileDiff[]> {
    const files: FileDiff[] = [];
    const fileSections = raw.split(/^diff --git /m).filter(Boolean);

    for (const section of fileSections) {
      const lines = section.split("\n");
      const headerMatch = lines[0]?.match(/a\/(.*) b\/(.*)/);
      if (!headerMatch) continue;

      const oldPath = headerMatch[1];
      const newPath = headerMatch[2];
      const binary = lines.some((l) => l.startsWith("Binary files"));

      const hunks: DiffHunk[] = [];
      let currentHunk: DiffHunk | null = null;
      let oldLine = 0;
      let newLine = 0;
      let additions = 0;
      let deletions = 0;
      // A diff without hunks still says what happened in its extended header:
      // an empty note that was just created, or one whose mode changed. Without
      // these the view had nothing to show and rendered two blank panes.
      let change: FileDiff["change"] = "modified";
      let oldMode: string | undefined;
      let newMode: string | undefined;

      for (const line of lines) {
        if (!currentHunk) {
          if (line.startsWith("new file mode ")) change = "added";
          else if (line.startsWith("deleted file mode ")) change = "deleted";
          else if (line.startsWith("old mode ")) oldMode = line.slice("old mode ".length).trim();
          else if (line.startsWith("new mode ")) newMode = line.slice("new mode ".length).trim();
        }
        const hunkMatch = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)/);
        if (hunkMatch) {
          if (currentHunk) hunks.push(currentHunk);
          oldLine = parseInt(hunkMatch[1]);
          newLine = parseInt(hunkMatch[3]);
          currentHunk = {
            oldStart: oldLine,
            oldLines: parseInt(hunkMatch[2] || "1"),
            newStart: newLine,
            newLines: parseInt(hunkMatch[4] || "1"),
            header: hunkMatch[5]?.trim() || "",
            lines: [],
          };
          continue;
        }
        if (!currentHunk) continue;
        if (line.startsWith("+")) {
          currentHunk.lines.push({
            type: "add",
            content: line.substring(1),
            newLineNo: newLine++,
          });
          additions++;
        } else if (line.startsWith("-")) {
          currentHunk.lines.push({
            type: "del",
            content: line.substring(1),
            oldLineNo: oldLine++,
          });
          deletions++;
        } else if (line.startsWith(" ")) {
          currentHunk.lines.push({
            type: "context",
            content: line.substring(1),
            oldLineNo: oldLine++,
            newLineNo: newLine++,
          });
        }
      }
      if (currentHunk) hunks.push(currentHunk);

      files.push({
        path: newPath,
        oldPath: oldPath !== newPath ? oldPath : undefined,
        binary,
        hunks,
        additions,
        deletions,
        change,
        oldMode,
        newMode,
      });
    }
    return files;
  }

  /**
   * How far the branch has drifted from its upstream, and whether it has one at
   * all. The two are reported apart on purpose: a branch that was never pushed
   * counts zero commits ahead, which otherwise reads exactly like "in sync" —
   * the one state where pushing matters most.
   */
  async getAheadBehind(): Promise<UpstreamState> {
    try {
      const out = await this.exec(["rev-list", "--left-right", "--count", "HEAD...@{upstream}"]);
      const [ahead, behind] = out.trim().split(/\s+/).map(Number);
      return { ahead: ahead || 0, behind: behind || 0, hasUpstream: true, hasCommits: true };
    } catch {
      // No upstream. Whether there is anything to publish then depends on the
      // branch having commits at all — a fresh repository has none.
      return { ahead: 0, behind: 0, hasUpstream: false, hasCommits: await this.hasCommits() };
    }
  }

  private async hasCommits(): Promise<boolean> {
    try {
      await this.exec(["rev-parse", "--verify", "HEAD"]);
      return true;
    } catch {
      return false;
    }
  }

  async remotes(): Promise<RemoteInfo[]> {
    try {
      const out = await this.exec(["remote", "-v"]);
      const map = new Map<string, RemoteInfo>();
      for (const line of out.split("\n")) {
        const match = line.match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)/);
        if (!match) continue;
        const [, name, url, type] = match;
        if (!map.has(name)) map.set(name, { name, fetchUrl: "", pushUrl: "" });
        const info = map.get(name)!;
        if (type === "fetch") info.fetchUrl = url;
        else info.pushUrl = url;
      }
      return Array.from(map.values());
    } catch {
      return [];
    }
  }

  async stashList(): Promise<StashEntry[]> {
    try {
      const out = await this.exec(["stash", "list", "--format=%gd|%gs|%aI"]);
      return out
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [ref, message, dateStr] = line.split("|");
          const index = parseInt(ref.replace("stash@{", "").replace("}", ""));
          return { index, message, date: new Date(dateStr) };
        });
    } catch {
      return [];
    }
  }

  async stashSave(message?: string): Promise<void> {
    const args = ["stash", "push"];
    if (message) args.push("-m", message);
    await this.enqueue(() => this.exec(args));
  }

  async stashPop(index = 0): Promise<void> {
    await this.enqueue(() => this.exec(["stash", "pop", `stash@{${index}}`]));
  }

  async stashDrop(index: number): Promise<void> {
    await this.enqueue(() => this.exec(["stash", "drop", `stash@{${index}}`]));
  }

  async init(): Promise<void> {
    await this.enqueue(() => this.exec(["init"]));
  }

  async addRemote(name: string, url: string): Promise<void> {
    await this.enqueue(() => this.exec(["remote", "add", name, url]));
  }

  /**
   * Points an existing remote somewhere else.
   *
   * `set-url` without `--push` moves the fetch URL, and the push URL with it
   * unless one was set separately — which is the behaviour the settings want:
   * a remote with one address keeps having one address.
   */
  async setRemoteUrl(name: string, url: string): Promise<void> {
    await this.enqueue(() => this.exec(["remote", "set-url", name, url]));
  }

  async removeRemote(name: string): Promise<void> {
    await this.enqueue(() => this.exec(["remote", "remove", name]));
  }

  async hasChanges(): Promise<boolean> {
    const s = await this.status();
    return s.length > 0;
  }

  private gitignorePath(): string {
    return `${this.repoPath}/.gitignore`;
  }

  async readGitignore(): Promise<string> {
    try {
      return await readFile(this.gitignorePath(), "utf-8");
    } catch {
      return "";
    }
  }

  async writeGitignore(content: string): Promise<void> {
    await this.enqueue(() => writeFile(this.gitignorePath(), content, "utf-8"));
  }

  /**
   * The name and email git would sign a commit with, and where each is set.
   *
   * One call rather than four: `--get-regexp` lists every scope's answer in
   * precedence order, which is exactly what the settings need to say whether a
   * value belongs to this vault or was inherited.
   */
  async identity(): Promise<GitIdentity> {
    const pattern = "^user\\.(name|email)$";
    if (this.supportsConfigScope) {
      try {
        return parseIdentity(
          await this.execAllowing([1], ["config", "--show-scope", "--get-regexp", pattern]),
        );
      } catch {
        // A git too old for --show-scope. The values are still readable, and
        // everything but naming their origin still works.
        this.supportsConfigScope = false;
      }
    }
    return parseIdentity(await this.execAllowing([1], ["config", "--get-regexp", pattern]));
  }

  /**
   * Writes one half of the identity for this repository, or removes it when
   * the value is empty.
   *
   * `--local` is the only place this writes. The name on the commits in this
   * vault is a property of this vault, and a plugin that also offered to
   * rewrite `~/.gitconfig` would be offering to change every other repository
   * on the computer from a settings screen that says nothing about them.
   *
   * Empty means removed rather than stored: git accepts `user.name = ""`
   * without complaint and then fails at commit time, which is the same
   * situation with an extra place to look for it.
   */
  async setIdentity(field: "name" | "email", value: string): Promise<void> {
    const key = `user.${field}`;
    const where = "--local";
    const trimmed = value.trim();
    if (trimmed === "") {
      await this.enqueue(() => this.execAllowing([5], ["config", where, "--unset", key]));
      return;
    }
    await this.enqueue(() => this.exec(["config", where, key, trimmed]));
  }

  async addToGitignore(pattern: string): Promise<void> {
    const current = await this.readGitignore();
    const lines = current.split("\n");
    if (lines.some((l) => l.trim() === pattern.trim())) return;
    const newContent =
      current.endsWith("\n") || current === ""
        ? current + pattern + "\n"
        : current + "\n" + pattern + "\n";
    await this.writeGitignore(newContent);
  }
}

export class GitError extends Error {
  constructor(
    message: string,
    public readonly command: string[],
    /** git's exit code, or null when the command never ran. */
    public readonly exitCode: number | null = null,
  ) {
    super(message);
    this.name = "GitError";
  }
}
