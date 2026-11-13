import { execFile } from "node:child_process";

/** Stop only the command tree owned by this request, including HTTPS helpers. */
async function stopCommand(child) {
    if (!child.pid) return;
    try { process.kill(child.pid, 0); }
    catch (error) { if (error.code === "ESRCH") return; throw error; }
    if (process.platform !== "win32") { child.kill("SIGKILL"); return; }
    await new Promise((resolve, reject) => {
        execFile("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, timeout: 5000 }, error => {
            if (!error) { resolve(); return; }
            try { process.kill(child.pid, 0); reject(new Error("Could not stop the Git process tree.")); }
            catch (check) { if (check.code === "ESRCH") resolve(); else reject(check); }
        });
    });
}

/** Own the deadline independently of execFile's exit/stdio callback. */
export function runGitCommand(repo, args, options = {}) {
    const { allowedExitCodes = [], signal, timeout = 120000, returnResult = false, input, ...processOptions } = options;
    signal?.throwIfAborted();
    return new Promise((resolve, reject) => {
        let settled = false, stopping = false, timer;
        const finish = (error, stdout) => {
            if (settled) return;
            settled = true; clearTimeout(timer); signal?.removeEventListener("abort", abort);
            repo.children.delete(child);
            if (error) reject(error); else resolve(stdout);
        };
        const stop = async reason => {
            if (settled || stopping) return;
            stopping = true;
            try { await stopCommand(child); finish(reason); }
            catch (error) { finish(error); }
            finally { child.stdout?.destroy(); child.stderr?.destroy(); }
        };
        const abort = () => {
            const error = new Error("Git operation cancelled."); error.name = "AbortError";
            void stop(error);
        };
        const child = execFile(repo.executable, ["--no-pager", ...args], {
            cwd: repo.root, windowsHide: true, maxBuffer: 32 * 1024 * 1024,
            encoding: "utf8", ...processOptions, timeout: 0,
            env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "Never", GIT_LITERAL_PATHSPECS: "1", GIT_OPTIONAL_LOCKS: "0", ...options.env },
        }, (error, stdout, stderr) => {
            if (stopping) return;
            const details = error && !allowedExitCodes.includes(error.code)
                ? [stderr, stdout].filter(value => value?.length).map(value => String(value).trim()).filter(Boolean).join("\n")
                : "";
            finish(error && !allowedExitCodes.includes(error.code)
                ? new Error(details || String(error.message).trim()) : undefined, returnResult ? { stdout, stderr, code: error?.code ?? 0 } : stdout);
        });
        repo.children.add(child);
        child.stdin?.on("error", () => {}); // An early Git exit is reported by execFile, not by an unhandled EPIPE.
        child.stdin?.end(input);
        if (timeout > 0) timer = setTimeout(() => void stop(new Error(`Git ${args[0]} timed out after ${Math.round(timeout / 1000)} seconds.`)), timeout);
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) abort();
    });
}
