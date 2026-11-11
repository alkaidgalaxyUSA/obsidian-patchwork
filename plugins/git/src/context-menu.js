import { FileContextActions } from "./file-context-actions";
import { renderFileActions } from "../../utils/file-menu-actions";
import { GIT_ACTIONS } from "./utils/git-action-definitions";

/** Git owns action semantics; hosts control only their root menu ordering. */
export function buildGitFileActions(controller, paths, validate = () => {}) {
    const files = new FileContextActions(controller, paths);
    const visibleIcons = new Set(["Add", GIT_ACTIONS.showDiff.title, GIT_ACTIONS.showHistory.title, GIT_ACTIONS.rollback.title, "Push…", "Fetch", "Merge...", "Branches...", "New Branch..."]);
    const actions = [];
    let separator = false;
    const action = (title, icon, callback, disabled = false) => {
        actions.push({ id: `git:file:${actions.length}`, label: title, icon: visibleIcons.has(title) ? icon : undefined,
            separatorBefore: separator, disabledReason: disabled ? "Unavailable for this selection" : controller.busy ? "Git is busy" : !controller.ready ? "Repository unavailable" : undefined,
            run: async () => { validate(); await callback(); } });
        separator = false;
    };
    action(GIT_ACTIONS.commitFile.title, GIT_ACTIONS.commitFile.icon, () => controller.openSelection(paths));
    action("Add", "plus", () => files.add());
    actions[actions.length - 1].disabledReason = undefined;
    separator = true;
    action("Annotate with Git Blame", "list", () => files.blame(), paths.length !== 1 || !controller.sourceFile(paths[0])?.extension);
    action(GIT_ACTIONS.showDiff.title, GIT_ACTIONS.showDiff.icon, () => controller.showDiff(paths));
    action(GIT_ACTIONS.compareRevision.title, GIT_ACTIONS.compareRevision.icon, () => files.compare("Compare with Revision"));
    action("Compare with Branch or Tag...", "git-branch", () => files.compare("Compare with Branch or Tag"));
    action(GIT_ACTIONS.showHistory.title, GIT_ACTIONS.showHistory.icon, () => controller.showHistory(paths));
    action("Show Current Revision", "git-commit", () => files.output("Current Revision", paths.length === 1 && controller.sourceFile(paths[0])?.extension
        ? ["show", `HEAD:${paths[0]}`] : ["log", "-1", "--format=fuller", "--stat", "--", ...paths]));
    action(GIT_ACTIONS.rollback.title, GIT_ACTIONS.rollback.icon, () => controller.rollback(paths));
    separator = true;
    action("Push…", "idea-expui-vcs-push_dark.svg", () => controller.network("push"));
    action("Pull…", "arrow-down-left", () => controller.network("pull"));
    action("Fetch", "branch-fetch", () => controller.network("fetch"));
    separator = true;
    action("Merge...", "idea-expui-vcs-merge_dark.svg", () => files.integrate("merge"));
    action("Rebase...", "git-branch", () => files.integrate("rebase"));
    separator = true;
    action("Branches...", "git-branch-flipped", () => files.branches());
    action("New Branch...", "plus", () => controller.newBranch());
    action("New Tag...", "tag", () => files.tag());
    action("Reset HEAD...", "undo-2", () => files.reset());
    separator = true;
    action("Stash Changes...", "archive", () => files.stash());
    action("Unstash Changes...", "archive-restore", () => files.unstash(), !controller.stashCount);
    separator = true;
    actions.push({ id: "git:github", label: "GitHub", icon: "github", separatorBefore: separator,
        children: [{ id: "git:github:open", label: "Open Repository in Browser",
            disabledReason: controller.busy || !controller.ready ? "Repository unavailable or busy" : undefined,
            run: async () => { validate(); await files.github(); } }] });
    separator = false;
    action("Manage Remotes...", "network", () => files.remotes());
    action("Clone...", "copy", () => files.clone());
    return [{ id: "git:files", label: "Git", children: actions }];
}

/** Native menus remain available when Project is disabled. */
export function addGitMenu(menu, controller, paths) {
    menu.dom.classList.add("pw-git-context-menu");
    const mounted = renderFileActions(menu, buildGitFileActions(controller, paths), "git", () => !controller.disposed);
    menu.onHide(() => mounted.dispose());
}
