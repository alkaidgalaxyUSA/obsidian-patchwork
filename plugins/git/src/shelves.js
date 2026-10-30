import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

/** Local, binary-safe shelves; only selected paths are reverted or restored. */
export class Shelves {
    constructor(repository) { this.repository = repository; }

    get directory() { return join(this.repository.gitDir, "patchwork-shelves"); }

    async write(path, content) {
        const handle = await open(path, "w");
        try { await handle.writeFile(content); await handle.sync(); }
        finally { await handle.close(); }
    }

    async patch(paths, cached = false) {
        return this.repository.run(["diff", "--binary", "--full-index", "--no-ext-diff", "--no-textconv", "--no-color", ...(cached ? ["--cached"] : []), "HEAD", "--", ...paths], { encoding: "buffer" });
    }

    async create(paths, message) {
        const repo = this.repository;
        const head = await repo.head();
        if (!head) throw new Error("Create an initial commit before shelving changes.");
        const entries = (await repo.status()).filter(entry => paths.includes(entry.path));
        if (!entries.length) throw new Error("Select tracked changes to shelve.");
        if (entries.some(entry => entry.untracked || entry.conflict)) throw new Error("Only tracked, conflict-free changes can be shelved.");
        paths = [...new Set(entries.flatMap(entry => [entry.path, entry.code.includes("R") ? entry.original : undefined].filter(Boolean)))];
        const [worktree, index] = await Promise.all([this.patch(paths), this.patch(paths, true)]);
        if (!worktree.length && !index.length) throw new Error("No file changes to shelve. Commit submodule changes inside the submodule first.");
        const shelf = { id: randomUUID(), title: message.trim().split(/\r?\n/)[0] || `Changes on ${await repo.branch()}`, paths, head, createdAt: new Date().toISOString() };
        const folder = join(this.directory, shelf.id);
        await mkdir(folder, { recursive: true });
        await this.write(join(folder, "worktree.patch"), worktree);
        await this.write(join(folder, "index.patch"), index);
        await this.write(join(folder, "shelf.json"), JSON.stringify(shelf, null, 2));
        // A durable shelf exists before any source file is reverted.
        const [currentWorktree, currentIndex] = await Promise.all([this.patch(paths), this.patch(paths, true)]);
        if (await repo.head() !== head || !worktree.equals(currentWorktree) || !index.equals(currentIndex)) {
            throw new Error("Files changed while shelving. The backup was saved; no files were reverted.");
        }
        try { await repo.run(["restore", "--source=HEAD", "--staged", "--worktree", "--", ...paths]); }
        catch (error) { throw new Error(`Shelf saved, but reverting the selected files failed. Recover it from View Options → Shelved Changes. ${error.message}`); }
        return shelf;
    }

    async list() {
        let folders;
        try { folders = await readdir(this.directory, { withFileTypes: true }); }
        catch (error) { if (error.code === "ENOENT") return []; throw error; }
        const shelves = [];
        for (const folder of folders) {
            if (!folder.isDirectory() || !/^[a-f\d-]{36}$/.test(folder.name)) continue;
            try {
                const shelf = JSON.parse(await readFile(join(this.directory, folder.name, "shelf.json"), "utf8"));
                if (shelf.id === folder.name && !shelf.restoredAt) shelves.push(shelf);
            } catch (error) { if (error.code !== "ENOENT") throw error; }
        }
        return shelves.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }

    async restore(id) {
        const shelf = (await this.list()).find(entry => entry.id === id);
        if (!shelf) throw new Error("The selected shelf is unavailable.");
        const repo = this.repository;
        const entries = await repo.status();
        if (entries.some(entry => shelf.paths.some(path => entry.path === path || entry.original === path))) {
            throw new Error("The shelved files already have local changes. Commit or shelve them before restoring this shelf.");
        }
        const folder = join(this.directory, id);
        const worktreePath = join(folder, "worktree.patch"), indexPath = join(folder, "index.patch");
        const worktree = await readFile(worktreePath), index = await readFile(indexPath);
        if (worktree.length) await repo.run(["apply", "--check", "--binary", worktreePath]);
        if (index.length) await repo.run(["apply", "--check", "--cached", "--binary", indexPath]);
        if (worktree.length) await repo.run(["apply", "--binary", worktreePath]);
        try {
            if (index.length) await repo.run(["apply", "--cached", "--binary", indexPath]);
            await this.write(join(folder, "shelf.json"), JSON.stringify({ ...shelf, restoredAt: new Date().toISOString() }, null, 2));
        } catch (error) {
            return { warning: `Working-tree changes were restored, but shelf completion failed. The backup remains available. ${error.message}` };
        }
        return {};
    }
}
