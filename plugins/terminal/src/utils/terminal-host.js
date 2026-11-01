/** Runs in the matching installed Electron runtime, keeping native PTY modules isolated. */
export function powerShellHost() {
    const pty = require(process.argv[1]);
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const shell = pty.spawn(process.argv[2], [], {
        name: "xterm-256color", cols: Number(process.argv[4]) || 100, rows: Number(process.argv[5]) || 24,
        cwd: process.argv[3], env, useConpty: true,
    });
    const send = message => process.stdout.write(JSON.stringify(message) + "\n");
    shell.onData(data => send({ type: "data", data }));
    shell.onExit(event => { send({ type: "exit", code: event.exitCode }); process.exit(0); });
    send({ type: "ready", pid: shell.pid });
    let pending = "";
    let closing = false;
    const close = () => {
        if (closing) return;
        closing = true;
        shell.kill();
        setTimeout(() => process.exit(0), 500).unref();
    };
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", chunk => {
        pending += chunk;
        let end;
        while ((end = pending.indexOf("\n")) >= 0) {
            const line = pending.slice(0, end);
            pending = pending.slice(end + 1);
            try {
                const message = JSON.parse(line);
                if (message.type === "input") shell.write(message.data);
                if (message.type === "resize") shell.resize(message.cols, message.rows);
                if (message.type === "close") close();
            } catch (error) { send({ type: "error", message: error.message }); }
        }
    });
    process.stdin.on("end", close);
    process.on("SIGTERM", close);
}
