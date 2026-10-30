import { spawn } from "node:child_process";
import { powerShellHost } from "./utils/terminal-host";

/** One persistent interactive shell and its terminal renderer. */
export class PowerShellSession {
    constructor(parent, runtime, cwd) {
        this.el = parent.createDiv({ cls: "pw-powershell-session" });
        this.cwd = cwd;
        this.runtime = runtime;
        this.terminal = new runtime.Terminal({
            cursorBlink: true, fontSize: 13, fontFamily: 'Consolas, "Cascadia Mono", monospace',
            scrollback: 10000, convertEol: false, allowProposedApi: false,
            theme: { background: "#1e1f22", foreground: "#bcbec4", cursor: "#bcbec4", selectionBackground: "#35415d" },
        });
        this.terminal.open(this.el);
        this.input = this.terminal.onData(data => this.send({ type: "input", data }));
        this.binary = this.terminal.onBinary(data => this.send({ type: "input", data }));
        this.resizeListener = this.terminal.onResize(size => this.send({ type: "resize", ...size }));
        this.observer = new this.el.ownerDocument.defaultView.ResizeObserver(() => this.fit());
        this.observer.observe(this.el);
        this.context = event => {
            event.preventDefault();
            const clipboard = this.el.ownerDocument.defaultView.navigator.clipboard;
            if (this.terminal.hasSelection()) void clipboard.writeText(this.terminal.getSelection());
            else void clipboard.readText().then(text => this.terminal.paste(text)).catch(() => {});
        };
        this.el.addEventListener("contextmenu", this.context);
        this.start();
    }

    start() {
        this.exited = false;
        this.child = spawn(this.runtime.executable, ["-e", `(${powerShellHost.toString()})()`,
            this.runtime.pty, this.runtime.shell, this.cwd, String(this.terminal.cols), String(this.terminal.rows)], {
            cwd: this.cwd, windowsHide: true, shell: false, stdio: ["pipe", "pipe", "pipe"],
            env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", VSCODE_DEV: "" },
        });
        let pending = "";
        this.child.stdout.setEncoding("utf8");
        this.child.stdout.on("data", chunk => {
            pending += chunk;
            let end;
            while ((end = pending.indexOf("\n")) >= 0) {
                const line = pending.slice(0, end); pending = pending.slice(end + 1);
                try {
                    const message = JSON.parse(line);
                    if (this.disposed) continue;
                    if (message.type === "data") this.terminal.write(message.data);
                    if (message.type === "ready") { this.pid = message.pid; this.fit(); }
                    if (message.type === "error") this.terminal.writeln(`\r\n${message.message}`);
                } catch { /* Ignore non-protocol diagnostics from the host runtime. */ }
            }
        });
        this.child.stderr.on("data", data => { if (!this.disposed) this.terminal.write(String(data)); });
        this.child.stdin.on("error", () => {});
        this.child.on("error", error => { if (!this.disposed) this.terminal.writeln(`\r\n${error.message}`); });
        this.child.on("exit", code => {
            this.exited = true;
            if (!this.disposed) this.terminal.writeln(`\r\n[PowerShell exited${code ? `: ${code}` : ""}]`);
        });
    }

    send(message) {
        if (!this.child?.stdin.writable || this.exited) return;
        this.child.stdin.write(JSON.stringify(message) + "\n");
    }

    fit() {
        if (this.disposed || !this.el.clientWidth || !this.el.clientHeight) return;
        const probe = this.el.ownerDocument.createElement("span");
        probe.style.cssText = "position:absolute;visibility:hidden;white-space:pre;font:13px Consolas, 'Cascadia Mono', monospace;line-height:normal";
        probe.textContent = "MMMMMMMMMM";
        this.el.append(probe);
        const bounds = probe.getBoundingClientRect();
        probe.remove();
        const cols = Math.max(10, Math.floor((this.el.clientWidth - 24) / (bounds.width / 10 || 8)));
        const rows = Math.max(2, Math.floor((this.el.clientHeight - 12) / (bounds.height || 16)));
        if (cols !== this.terminal.cols || rows !== this.terminal.rows) this.terminal.resize(cols, rows);
    }

    focus() { this.fit(); this.terminal.focus(); }
    dispose() {
        this.disposed = true;
        this.observer.disconnect();
        this.input.dispose(); this.binary.dispose(); this.resizeListener.dispose();
        this.send({ type: "close" });
        this.child?.stdin.end();
        const child = this.child;
        const timer = setTimeout(() => { if (child && child.exitCode === null) child.kill(); }, 1500);
        timer.unref?.();
        this.terminal.dispose();
        this.el.remove();
    }
}
