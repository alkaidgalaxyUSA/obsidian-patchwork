import { CommitFileActions } from "../commit/file-actions";
import { iconName } from "../utils/icons";
import { confirm, prompt } from "../dialogs";
import { GIT_ACTIONS } from "../utils/git-action-definitions";

/** Extend the established Log menus with the imported headless operations. */
export function addHistoryCommitMenu(menu, pane, commit) {
    const clipboard = pane.el.ownerDocument.defaultView.navigator.clipboard;
    const unavailable = !pane.controller.ready || pane.controller.busy || pane.disposed;
    const mutationUnavailable = unavailable || !!pane.controller.operation || pane.el.ownerDocument !== pane.app.workspace.containerEl.ownerDocument;
    const root = pane.controller.repository.root;
    menu.addItem(item => item.setTitle("Copy revision").onClick(() => clipboard.writeText(commit.hash)));
    menu.addItem(item => item.setTitle("Copy commit message").onClick(() => clipboard.writeText(commit.fullMessage)));
    menu.addSeparator();
    menu.addItem(item => item.setTitle("Compare with HEAD…").setDisabled(unavailable).onClick(() => pane.controller.compare(commit.hash, "HEAD")));
    menu.addItem(item => item.setTitle("Reset HEAD to Here…").setDisabled(mutationUnavailable).onClick(() => pane.controller.openManager("reset", commit.hash)));
    menu.addItem(item => item.setTitle("Interactive Rebase from Here…").setDisabled(mutationUnavailable).onClick(() => pane.controller.openManager("rebase", commit.parents.length ? `${commit.hash}^` : "ROOT")));
    const run = action => () => pane.action(async controller => {
        if (root !== controller.repository.root) throw new Error("The repository changed. Reopen the commit menu.");
        await controller.repository.assertNoOperation();
        if (!/^[a-f\d]{40,64}$/i.test(commit.hash)) throw new Error("This commit is unavailable.");
        await action(controller, pane.history.git);
    });
    menu.addItem(item => item.setTitle("Create branch here…").setDisabled(mutationUnavailable).setIcon(iconName("plus")).onClick(run(async (controller, git) => {
        const name = await prompt(controller, "New Branch", "Branch name");
        if (!name || pane.disposed) return;
        await controller.repository.run(["check-ref-format", `refs/heads/${name}`]);
        if (name.startsWith("-")) throw new Error("Enter a valid branch name.");
        await git.createBranch(name, commit.hash);
    })));
    menu.addItem(item => item.setTitle("Check out revision…").setDisabled(mutationUnavailable).setIcon(iconName("git-log-checkout")).onClick(run(async (controller, git) => {
        if (await confirm(controller, "Check Out Revision", `Check out ${commit.hash.slice(0, 12)} in detached HEAD mode? Git preserves local changes or refuses the checkout.`, "Check Out") && !pane.disposed) await git.checkout(commit.hash);
    })));
    menu.addItem(item => item.setTitle("Cherry-pick commit…").setIcon(iconName("git-cherry-pick")).setDisabled(mutationUnavailable || commit.parents.length > 1).onClick(run(async (controller, git) => {
        if (await confirm(controller, "Cherry-pick Commit", `Apply ${commit.hash.slice(0, 12)} to the current branch?`, "Cherry-pick") && !pane.disposed) await git.cherryPick(commit.hash);
    })));
    menu.addItem(item => item.setTitle("Revert commit…").setIcon(iconName("git-rollback")).setDisabled(mutationUnavailable || commit.parents.length > 1).onClick(run(async (controller, git) => {
        if (await confirm(controller, "Revert Commit", `Create a new commit reverting ${commit.hash.slice(0, 12)}?`, "Revert") && !pane.disposed) await git.revert(commit.hash);
    })));
}

export function addHistoryFileMenu(menu, pane, commit, file) {
    menu.addItem(item => item.setTitle(GIT_ACTIONS.showDiff.title).setIcon(iconName(GIT_ACTIONS.showDiff.icon)).onClick(() => pane.openDiff(commit, file)));
    menu.addItem(item => item.setTitle(GIT_ACTIONS.showHistory.title).setIcon(iconName(GIT_ACTIONS.showHistory.icon)).onClick(() => pane.controller.openHistory([file.path], pane.el.ownerDocument)));
    const source = new CommitFileActions(pane.controller, [file.path], pane.el.ownerDocument);
    menu.addItem(item => item.setTitle("Compare with Local").setIcon(iconName("git-show-diff"))
        .setDisabled(!source.existing(file.path)).onClick(() => pane.openLocalDiff(commit, file)));
    menu.addItem(item => item.setTitle("Compare Before with Local").setIcon(iconName("git-show-diff"))
        .onClick(() => pane.openDiff(commit, file)));
    if (!file.status.startsWith("D") && source.existing(file.path)) {
        menu.addItem(item => item.setTitle("Edit Source").setIcon(iconName("pencil")).onClick(() => {
            if (pane.disposed || !pane.el.isConnected) return;
            return source.open();
        }));
    }
    menu.addSeparator();
    menu.addItem(item => item.setTitle("Restore file from this commit…").setIcon(iconName("git-rollback")).setDisabled(file.status.startsWith("D")).onClick(() => pane.action(async controller => {
        const paths = [file.original, file.path].filter(Boolean);
        const dirty = (await controller.repository.status()).some(entry => paths.includes(entry.path) || paths.includes(entry.original));
        if (dirty) throw new Error("Commit or shelve local changes to this file before restoring it.");
        if (await confirm(controller, "Restore File", `Restore ${file.path} from ${commit.hash.slice(0, 12)}? The restored version will be staged.`, "Restore") && !pane.disposed) await pane.history.git.restoreFile(commit.hash, file.path);
    })));
}
