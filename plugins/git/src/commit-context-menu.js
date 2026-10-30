import { iconName } from "../../utils/icons";

/** Commit-specific actions stay at the first level of the menu. */
export function addCommitMenu(menu, controller, paths, changelistId) {
    menu.setUseNativeMenu(false);
    menu.dom.classList.add("pw-git-context-menu", "pw-git-commit-context-menu");
    const entries = controller.entries.filter(entry => paths.includes(entry.path));
    const tracked = entries.filter(entry => !entry.untracked);
    const unavailable = controller.busy || !controller.ready;
    const action = (title, icon, callback, disabled = false) => menu.addItem(item => {
        item.setTitle(title).setDisabled(unavailable || disabled).onClick(() => void callback());
        if (icon) item.setIcon(iconName(icon));
    });
    action("Commit File...", null, () => controller.openSelection(paths), !entries.length || entries.some(entry => entry.conflict));
    action("Rollback...", "git-rollback", () => controller.rollback(paths), !tracked.length || tracked.some(entry => entry.conflict || entry.original || entry.code.includes("A")));
    action("Move to Another Changelist...", null, () => controller.moveToChangelist(tracked.map(entry => entry.path)), !tracked.length);
    action("Show Diff", "git-show-diff", () => controller.showDiff(paths), !entries.length);
    action("Show Diff in a New Tab", "git-show-diff", () => controller.showDiff(paths, true), !entries.length);
    action("Jump to Source", null, () => controller.jumpToSource(paths), paths.length !== 1 || !controller.sourceFile(paths[0]));
    menu.addSeparator();
    action("Delete...", null, () => controller.deleteFiles(paths), !paths.length || paths.some(path => !controller.sourceFile(path)));
    action("Add to VCS", null, () => controller.act(() => controller.repository.stage(entries.filter(entry => entry.untracked).map(entry => entry.path))), !entries.some(entry => entry.untracked));
    menu.addItem(item => {
        const disabled = unavailable || !entries.length || entries.some(entry => !entry.untracked);
        item.setTitle("Add to .gitignore").setDisabled(disabled);
        const submenu = item.setSubmenu();
        submenu.setUseNativeMenu(false);
        submenu.dom.classList.add("pw-git-context-submenu", "pw-git-commit-context-submenu");
        for (const target of [".gitignore", ".git/info/exclude"]) {
            submenu.addItem(child => child.setTitle(target).setIcon(iconName("ban")).setDisabled(disabled)
                .onClick(() => void controller.ignoreFiles(paths, target)));
        }
    });
    menu.addSeparator();
    action("New Changelist", "plus", () => controller.newChangelist());
    action("Edit Changelist...", "pen-line", () => controller.editChangelist(changelistId), !changelistId);
    action("Create Patch from Local Changes...", "diff", () => controller.exportPatch(paths), !entries.length || entries.some(entry => entry.conflict));
    action("Copy as Patch to Clipboard", null, () => controller.copyPatch(paths), !entries.length || entries.some(entry => entry.conflict));
    action("Shelve Changes...", "git-shelve", () => controller.shelve(paths, true), !entries.length || entries.some(entry => entry.untracked || entry.conflict));
    menu.addSeparator();
    menu.addItem(item => item.setTitle("Refresh").setIcon(iconName("refresh-cw")).setDisabled(controller.busy).onClick(() => void controller.refresh()));
    menu.addSeparator();
    for (const [title, placeholders] of [
        ["Local History", ["Show History (placeholder)", "Show Recent Changes (placeholder)"]],
        ["Git", ["Repository Actions (placeholder)", "Branch Actions (placeholder)"]],
    ]) {
        menu.addItem(item => {
            item.setTitle(title);
            const submenu = item.setSubmenu();
            submenu.setUseNativeMenu(false);
            submenu.dom.classList.add("pw-git-context-submenu", "pw-git-commit-context-submenu");
            for (const label of placeholders) submenu.addItem(child => child.setTitle(label).setDisabled(true));
        });
    }
}
