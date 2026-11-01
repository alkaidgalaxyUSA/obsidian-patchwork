import { isAbsolute } from "node:path";
import { choose, confirm, prompt, showOutput } from "./dialogs";

/** File history and repository operations used by the explorer context menu. */
export class FileContextActions {
    constructor(controller, paths) {
        this.controller = controller;
        this.app = controller.app;
        this.repository = controller.repository;
        this.paths = paths;
    }

    async revision(title, initial = "HEAD") {
        const ref = await prompt(this.controller, title, "Revision, branch or tag", initial);
        if (!ref) return;
        return (await this.repository.run(["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`])).trim();
    }

    output(title, args) {
        return this.controller.act(async () => showOutput(this.controller, title, await this.repository.run(args)));
    }

    compare(title) {
        return this.controller.act(async () => {
            const revision = await this.revision(title);
            if (!revision) return;
            showOutput(this.controller, title, await this.repository.run(["diff", "--no-ext-diff", "--no-textconv", "--no-color", revision, "--", ...this.paths]));
        });
    }

    integrate(action) {
        return this.controller.act(async () => {
            const revision = await this.revision(`${action === "merge" ? "Merge" : "Rebase"}...`);
            if (!revision || !await confirm(this.controller, `${action === "merge" ? "Merge" : "Rebase"} branch`,
                `Apply ${action} using ${revision}? This changes the current branch.`, "Continue")) return;
            await this.repository.run(action === "merge" ? ["merge", "--no-edit", revision] : ["rebase", revision]);
        });
    }

    branches() {
        return this.controller.act(async () => {
            const refs = (await this.repository.run(["for-each-ref", "--format=%(refname:short)", "refs/heads"])).trim().split("\n").filter(Boolean);
            const choice = await choose(this.controller, "Check Out Branch", refs.map(ref => ({ name: ref })));
            if (choice) await this.repository.run(["switch", "--", choice.name]);
        });
    }

    tag() {
        return this.controller.act(async () => {
            const name = await prompt(this.controller, "New Tag", "Tag name");
            if (!name) return;
            await this.repository.run(["check-ref-format", `refs/tags/${name}`]);
            await this.repository.run(["tag", "--", name]);
        });
    }

    reset() {
        return this.controller.act(async () => {
            const revision = await this.revision("Reset HEAD");
            if (!revision || !await confirm(this.controller, "Reset HEAD", `Move HEAD to ${revision} and unstage changes? Working files will be preserved.`, "Reset")) return;
            await this.repository.run(["reset", "--mixed", revision, "--"]);
        });
    }

    stash() {
        return this.controller.act(async () => {
            const message = await prompt(this.controller, "Stash Changes", "Stash name", "Local changes");
            if (message) await this.repository.run(["stash", "push", "--include-untracked", "-m", message, "--", ...this.paths]);
        });
    }

    unstash() {
        return this.controller.act(async () => {
            const entries = (await this.repository.run(["stash", "list", "--format=%gd%x09%s"])).trim().split("\n").filter(Boolean);
            const choice = await choose(this.controller, "Unstash Changes", entries.map(entry => ({ name: entry, ref: entry.split("\t")[0] })));
            if (!choice || !await confirm(this.controller, "Apply Stash", `Apply ${choice.name}? The stash will be kept.`, "Apply")) return;
            await this.repository.run(["stash", "apply", choice.ref]);
        });
    }

    remotes() {
        return this.controller.act(async () => {
            const remotes = (await this.repository.run(["remote"])).trim().split("\n").filter(Boolean);
            const choice = await choose(this.controller, "Manage Remotes", [{ name: "Add Remote...", add: true }, ...remotes.map(name => ({ name }))]);
            if (!choice) return;
            const name = choice.add ? await prompt(this.controller, "Add Remote", "Remote name", "origin") : choice.name;
            if (!name || name.startsWith("-")) return;
            const initial = choice.add ? "" : (await this.repository.run(["remote", "get-url", "--", name])).trim();
            const url = await prompt(this.controller, "Remote URL", "Repository URL", initial);
            if (url) await this.repository.run(choice.add ? ["remote", "add", "--", name, url] : ["remote", "set-url", "--", name, url]);
        });
    }

    clone() {
        return this.controller.act(async () => {
            const url = await prompt(this.controller, "Clone Repository", "Repository URL");
            if (!url) return;
            const directory = await prompt(this.controller, "Clone Repository", "New absolute destination directory");
            if (!directory) return;
            if (!isAbsolute(directory)) throw new Error("Enter an absolute destination directory.");
            await this.repository.run(["clone", "--", url, directory]);
        });
    }

    github() {
        return this.controller.act(async () => {
            const remote = (await this.repository.run(["remote", "get-url", "origin"])).trim();
            const match = /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([^\s]+)$/.exec(remote);
            if (!match) throw new Error("The origin remote is not a GitHub repository.");
            const { shell } = require("electron");
            await shell.openExternal(`https://github.com/${match[1].replace(/\.git$/, "")}`);
        });
    }
}
