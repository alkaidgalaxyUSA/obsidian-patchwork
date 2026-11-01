import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Reuse installed terminal packages and their own native-module runtime. */
export function findTerminalRuntime() {
    const roots = [
        process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Programs", "Microsoft VS Code"),
        process.env.ProgramFiles && join(process.env.ProgramFiles, "Microsoft VS Code"),
    ].filter(Boolean);
    for (const root of roots) {
        const executable = join(root, "Code.exe");
        if (!existsSync(executable)) continue;
        const versions = [root, ...readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => join(root, entry.name))];
        for (const version of versions) {
            const modules = join(version, "resources", "app", "node_modules.asar");
            const pty = join(modules, "node-pty");
            const xterm = join(modules, "@xterm", "xterm");
            if (!existsSync(join(pty, "package.json")) || !existsSync(join(xterm, "package.json"))) continue;
            const shell = join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
            if (!existsSync(shell)) throw new Error("Windows PowerShell is unavailable.");
            return { executable, pty, shell, Terminal: require(xterm).Terminal, css: readFileSync(join(xterm, "css", "xterm.css"), "utf8") };
        }
    }
    throw new Error("The installed terminal runtime is unavailable. Restore the existing VS Code installation to use Terminal.");
}
