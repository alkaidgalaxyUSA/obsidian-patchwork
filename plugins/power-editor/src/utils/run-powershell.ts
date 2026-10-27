import { App, FileSystemAdapter, Notice, Platform } from "obsidian";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Buffer } from "node:buffer";

export function canRunPowerShell(language: string): boolean {
    return Platform.isWin && /^(powershell|pwsh|ps1)$/i.test(language);
}

/** Prefill the editable prompt once; only the user's Enter may accept the command. */
export function powerShellInputCommand(script: string): string {
    const source = Buffer.from(script.replace(/\r\n?/g, "\n"), "utf16le").toString("base64");
    return `
Import-Module PSReadLine -MinimumVersion 2.0 -ErrorAction Stop
$patchworkReadLine = (Get-Item Function:\\PSConsoleHostReadLine -ErrorAction Stop).ScriptBlock
Set-Item Function:\\global:PSConsoleHostReadLine -Value ({
    Set-Item Function:\\global:PSConsoleHostReadLine -Value $patchworkReadLine
    $prefill = Register-EngineEvent -SourceIdentifier PowerShell.OnIdle -MaxTriggerCount 1 -Action {
        $line = $null
        $cursor = 0
        [Microsoft.PowerShell.PSConsoleReadLine]::GetBufferState([ref]$line, [ref]$cursor)
        if ($line.Length -eq 0) {
            $command = [System.Text.Encoding]::Unicode.GetString([System.Convert]::FromBase64String('${source}'))
            [Microsoft.PowerShell.PSConsoleReadLine]::Insert($command)
        }
    }
    try {
        & $patchworkReadLine
    } finally {
        Unregister-Event -SourceIdentifier PowerShell.OnIdle -ErrorAction SilentlyContinue
        Remove-Job -Job $prefill -Force -ErrorAction SilentlyContinue
    }
}.GetNewClosure())
Remove-Variable patchworkReadLine -ErrorAction SilentlyContinue
`;
}

/** Run only on an explicit user action; never write note contents to a script file. */
export function runPowerShell(app: App, script: string): void {
    if (!Platform.isWin || !(app.vault.adapter instanceof FileSystemAdapter)) {
        new Notice("Running PowerShell requires a local Windows vault.");
        return;
    }
    if (!script.trim()) {
        new Notice("This code block is empty.");
        return;
    }
    const candidates = [
        process.env.ProgramFiles && join(process.env.ProgramFiles, "PowerShell", "7", "pwsh.exe"),
        process.env.SystemRoot && join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
    ];
    const executable = candidates.find((path): path is string => Boolean(path && existsSync(path)));
    if (!executable) {
        new Notice("PowerShell was not found.");
        return;
    }
    // Encode the complete block as data, preserving quotes, Unicode and newlines.
    // Leave room below Windows' 32,767-character process command-line limit.
    const encoded = Buffer.from(powerShellInputCommand(script), "utf16le").toString("base64");
    const cwd = app.vault.adapter.getBasePath();
    const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;
    // A detached Node process can have no visible console. Let Start-Process
    // allocate a real interactive window with its own standard handles instead.
    const launcher = `$ErrorActionPreference = 'Stop'; Start-Process -FilePath ${quote(executable)} -WorkingDirectory ${quote(cwd)} -WindowStyle Normal -ArgumentList @('-NoLogo', '-NoProfile', '-NoExit', '-EncodedCommand', '${encoded}')`;
    if (launcher.length + executable.length > 30000) {
        new Notice("This code block is too large to run directly. Save it as a .ps1 file instead.");
        return;
    }
    try {
        const child = spawn(executable, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", launcher], {
            cwd,
            windowsHide: true,
            shell: false,
            stdio: "ignore",
        });
        child.once("error", () => new Notice("Could not open PowerShell."));
        child.once("exit", (code) => {
            if (code !== 0) new Notice("Could not open PowerShell.");
        });
        child.unref();
    } catch {
        new Notice("Could not open PowerShell.");
    }
}
