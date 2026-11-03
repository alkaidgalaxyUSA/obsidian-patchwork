import { iconName } from "../utils/icons";
import { scopeGitMenu } from "../utils/portals";
import { addGitMenu } from "../context-menu";
import { CommitFileActions } from "./file-actions";

/** Commit-specific actions stay at the first level of the menu. */
export function addCommitMenu(menu, controller, paths, changelistId) {
    menu.setUseNativeMenu(false);
    menu.dom.classList.add("pw-git-context-menu", "pw-git-commit-context-menu");
    const entries = controller.entries.filter(entry => paths.includes(entry.path));
    const tracked = entries.filter(entry => !entry.untracked);
    const files = new CommitFileActions(controller, paths, menu.dom.ownerDocument);
    const unversionedOnly = !changelistId && entries.length > 0 && entries.every(entry => entry.untracked);
    const unavailable = controller.busy || !controller.ready;
    const action = (title, icon, callback, disabled = false) => menu.addItem(item => {
        item.setTitle(title).setDisabled(unavailable || disabled).onClick(() => void callback());
        if (icon) item.setIcon(iconName(icon));
    });
    action("Commit File...", null, () => controller.openSelection(paths), !entries.length || entries.some(entry => entry.conflict));
    action("Rollback...", "git-rollback", () => controller.rollback(paths), !tracked.length || tracked.some(entry => entry.conflict || entry.original || entry.code.includes("A")));
    action("Move to Another Changelist...", null, () => controller.moveToChangelist(tracked.map(entry => entry.path)), !tracked.length);
    action("Show Diff", "git-show-diff", () => controller.showDiff(paths), !entries.length);
    action("Show Diff in a New Window", "git-show-diff", () => controller.showDiff(paths, "window"), !entries.length);
    action("Jump to Source", "idea/expui/general/edit_dark.svg", () => files.open(), paths.length !== 1 || !files.existing(paths[0]));
    action("Copy Path/Reference...", null, () => files.copy(), !paths.length);
    menu.addSeparator();
    action("Delete...", null, () => files.delete(), !paths.length || paths.some(path => !files.existing(path)));
    action("Add to VCS", null, () => files.addToVcs(), !entries.some(entry => entry.untracked));
    if (unversionedOnly) menu.addItem(item => {
        const disabled = unavailable || !entries.length || entries.some(entry => !entry.untracked);
        item.setTitle("Add to .gitignore").setIcon(iconName("idea/expui/fileTypes/ignored_dark.svg")).setDisabled(disabled);
        const submenu = scopeGitMenu(item.setSubmenu(), menu.dom);
        menu.onHide(() => submenu.hide());
        submenu.setUseNativeMenu(false);
        submenu.dom.classList.add("pw-git-context-submenu", "pw-git-commit-context-submenu");
        for (const target of [".gitignore", ".git/info/exclude"]) {
            submenu.addItem(child => child.setTitle(target).setIcon(iconName("ban")).setDisabled(disabled)
                .onClick(() => void controller.ignoreFiles(paths, target)));
        }
    });
    menu.addSeparator();
    if (changelistId) {
        action("New Changelist", "plus", () => controller.newChangelist());
        action("Edit Changelist...", "idea/expui/general/edit_dark.svg", () => controller.editChangelist(changelistId));
    }
    action("Create Patch from Local Changes...", "git-show-diff", () => controller.exportPatch(paths), !entries.length || entries.some(entry => entry.conflict));
    action("Copy as Patch to Clipboard", null, () => controller.copyPatch(paths), !entries.length || entries.some(entry => entry.conflict));
    action("Shelve Changes...", "git-shelve", () => controller.shelve(paths, true), !entries.length || entries.some(entry => entry.untracked || entry.conflict));
    menu.addSeparator();
    menu.addItem(item => item.setTitle("Refresh").setIcon(iconName("refresh-cw")).setDisabled(controller.busy).onClick(() => void controller.refresh()));
    menu.addSeparator();
    menu.addItem(item => {
        item.setTitle("Local History");
        const submenu = scopeGitMenu(item.setSubmenu(), menu.dom);
        menu.onHide(() => submenu.hide());
        submenu.setUseNativeMenu(false);
        submenu.dom.classList.add("pw-git-context-submenu", "pw-git-commit-context-submenu");
        for (const label of ["Show History...", "Show Project History...", "Recent Changes", "Put Label..."]) {
            submenu.addItem(child => child.setTitle(label).setDisabled(true));
        }
    });
    addGitMenu(menu, controller, paths);
}
