/** File operations match IDEA's Git context-menu grouping. */
export function addGitMenu(menu, controller, paths) {
    menu.dom.classList.add("pw-git-context-menu");
    menu.addItem(item => {
        item.setTitle("Git").setIcon("git-branch");
        const submenu = item.setSubmenu();
        submenu.dom.classList.add("pw-git-context-submenu");
        const action = (title, icon, callback, disabled = false) => submenu.addItem(entry => entry.setTitle(title).setIcon(icon)
            .setDisabled(disabled || controller.busy || !controller.ready).onClick(callback));
        action("Commit…", "git-commit-horizontal", () => controller.openSelection(paths));
        action("Add", "plus", () => controller.act(() => controller.repository.stage(paths)));
        action("Unstage", "minus", () => controller.act(() => controller.repository.unstage(paths)));
        submenu.addSeparator();
        action("Show Diff", "diff", () => controller.showDiff(paths));
        action("Show History", "history", () => controller.showHistory(paths));
        action("Rollback…", "undo-2", () => controller.rollback(paths));
        submenu.addSeparator();
        action("Fetch", "download", () => controller.network("fetch"));
        action("Pull…", "arrow-down-left", () => controller.network("pull"));
        action("Push…", "arrow-up-right", () => controller.network("push"));
    });
}
