import { Notice } from "obsidian";
import { confirm, prompt } from "../dialogs";

/** Extend the established Log menus with the imported headless operations. */
export function addHistoryCommitMenu(menu, pane, commit) {
    const clipboard = pane.el.ownerDocument.defaultView.navigator.clipboard;
    menu.addItem(item => item.setTitle("Copy revision").onClick(() => clipboard.writeText(commit.hash)));
    menu.addItem(item => item.setTitle("Copy commit message").onClick(() => clipboard.writeText(commit.fullMessage)));
    menu.addSeparator();
    const run = action => () => pane.action(async controller => {
        if (!/^[a-f\d]{40,64}$/i.test(commit.hash)) throw new Error("This commit is unavailable.");
        await action(controller, pane.history.git);
    });
    menu.addItem(item => item.setTitle("Create branch here…").setIcon("git-branch-plus").onClick(run(async (controller, git) => {
        const name = await prompt(controller, "New Branch", "Branch name");
        if (!name || pane.disposed) return;
        await controller.repository.run(["check-ref-format", `refs/heads/${name}`]);
        if (name.startsWith("-")) throw new Error("Enter a valid branch name.");
        await git.createBranch(name, commit.hash);
    })));
    menu.addItem(item => item.setTitle("Check out revision…").setIcon("log-in").onClick(run(async (controller, git) => {
        if (await confirm(controller, "Check Out Revision", `Check out ${commit.hash.slice(0, 12)} in detached HEAD mode? Git preserves local changes or refuses the checkout.`, "Check Out") && !pane.disposed) await git.checkout(commit.hash);
    })));
    menu.addItem(item => item.setTitle("Cherry-pick commit…").setIcon("git-cherry-pick").setDisabled(commit.parents.length > 1).onClick(run(async (controller, git) => {
        if (await confirm(controller, "Cherry-pick Commit", `Apply ${commit.hash.slice(0, 12)} to the current branch?`, "Cherry-pick") && !pane.disposed) await git.cherryPick(commit.hash);
    })));
    menu.addItem(item => item.setTitle("Revert commit…").setIcon("undo-2").setDisabled(commit.parents.length > 1).onClick(run(async (controller, git) => {
        if (await confirm(controller, "Revert Commit", `Create a new commit reverting ${commit.hash.slice(0, 12)}?`, "Revert") && !pane.disposed) await git.revert(commit.hash);
    })));
}

export function addHistoryFileMenu(menu, pane, commit, file) {
    menu.addItem(item => item.setTitle("Show Diff").setIcon("file-diff").onClick(() => pane.openDiff(commit, file)));
    menu.addItem(item => item.setTitle("Show History").setIcon("history").onClick(() => pane.controller.openHistory([file.path], pane.el.ownerDocument)));
    const current = pane.controller.sourceFile(file.path);
    menu.addItem(item => item.setTitle("Open current file").setIcon("file").setDisabled(!current).onClick(async () => {
        if (!current || pane.disposed) return;
        if (pane.el.ownerDocument !== pane.app.workspace.containerEl.ownerDocument) { new Notice("Open the current file from the main window."); return; }
        await pane.controller.jumpToSource([file.path]);
    }));
    menu.addSeparator();
    menu.addItem(item => item.setTitle("Restore file from this commit…").setIcon("undo-2").setDisabled(file.status.startsWith("D")).onClick(() => pane.action(async controller => {
        const paths = [file.original, file.path].filter(Boolean);
        const dirty = (await controller.repository.status()).some(entry => paths.includes(entry.path) || paths.includes(entry.original));
        if (dirty) throw new Error("Commit or shelve local changes to this file before restoring it.");
        if (await confirm(controller, "Restore File", `Restore ${file.path} from ${commit.hash.slice(0, 12)}? The restored version will be staged.`, "Restore") && !pane.disposed) await pane.history.git.restoreFile(commit.hash, file.path);
    })));
}
