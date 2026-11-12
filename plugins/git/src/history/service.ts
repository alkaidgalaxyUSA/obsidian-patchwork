/*!
MIT License

Copyright (c) 2025 Chris Oguntolu

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

*/
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import type PatchworkGitPlugin from "../main";
import { GitService } from "./git/git-service";
import type { CommitFileInfo, HistoryLogOptions } from "./types";

/** Headless capabilities. Patchwork's existing views own every control and layout. */
export class GitHistoryService {
    private readonly backend: GitService;
    get git(): GitService { this.backend.setRepoPath(this.plugin.repository.root); return this.backend; }
    private disposed = false;
    private listeners = new Set<() => void>();
    private details = new Map<string, Promise<CommitFileInfo[]>>();

    constructor(private plugin: PatchworkGitPlugin) {
        this.backend = new GitService(plugin.repository.root, {
            git: async () => ({ binary: { path: plugin.repository.executable, source: "path" }, tried: [plugin.repository.executable] }),
            env: async extra => ({ ...process.env, ...extra }),
        });
        this.git.coordinate = action => plugin.repository.mutate(async () => {
            if (this.disposed) throw new Error("Git history has been unloaded.");
            const controller = plugin.controller;
            controller.busy = true;
            controller.render();
            try { return await action(); }
            finally {
                controller.busy = false;
                await controller.refresh(true);
                if (!controller.disposed) controller.render();
                this.invalidate();
            }
        });
    }

    onChange(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    invalidate(): void {
        if (!this.disposed) for (const listener of [...this.listeners]) {
            try { listener(); } catch (error) { console.error("Git history subscriber failed.", error); }
        }
    }

    reset(): void { this.details.clear(); this.invalidate(); }

    async log(options: HistoryLogOptions) {
        if (this.disposed) throw new Error("Git history has been unloaded.");
        this.git.setRepoPath(this.plugin.repository.root);
        const paths = options.paths ?? [];
        let follow = options.follow !== false && paths.length === 1;
        if (follow) {
            try { follow = !(await stat(resolve(this.plugin.repository.root, paths[0]))).isDirectory(); }
            catch {
                // A deleted file still needs --follow; a tracked directory is a tree.
                try { follow = (await this.plugin.repository.run(["cat-file", "-t", `HEAD:${paths[0]}`])).trim() !== "tree"; }
                catch { follow = true; }
            }
        }
        const commits = await this.git.log({ ...options, follow });
        if (this.disposed) throw new Error("Git history has been unloaded.");
        return commits;
    }

    files(hash: string): Promise<CommitFileInfo[]> {
        if (this.disposed) return Promise.reject(new Error("Git history has been unloaded."));
        this.git.setRepoPath(this.plugin.repository.root);
        let detail = this.details.get(hash);
        if (!detail) {
            detail = this.git.showCommitFiles(hash).catch(error => { this.details.delete(hash); throw error; });
            this.details.set(hash, detail);
            if (this.details.size > 128) this.details.delete(this.details.keys().next().value!);
        }
        return detail;
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.listeners.clear();
        this.details.clear();
        this.git.dispose();
    }
}
