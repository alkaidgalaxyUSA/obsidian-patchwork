import { readdir } from "node:fs/promises";
import { join } from "node:path";

/** Do not follow linked directories or descend into Git/application internals. */
export async function discoverRoots(vaultPath, validate = () => {}) {
    const pending = [vaultPath], roots = [];
    const excluded = new Set([".git", ".obsidian", "node_modules", ".idea", ".trash"]);
    while (pending.length) {
        validate();
        const directory = pending.pop();
        let entries;
        try { entries = await readdir(directory, { withFileTypes: true }); }
        catch (error) { if (["EACCES", "ENOENT", "EPERM"].includes(error.code)) continue; throw error; }
        validate();
        if (entries.some(entry => entry.name === ".git" && !entry.isSymbolicLink())) roots.push(directory);
        for (const entry of entries) if (entry.isDirectory() && !entry.isSymbolicLink() && !excluded.has(entry.name)) pending.push(join(directory, entry.name));
    }
    return roots.sort((a, b) => a.localeCompare(b));
}
