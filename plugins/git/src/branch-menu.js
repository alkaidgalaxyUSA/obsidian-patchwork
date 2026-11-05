import { scopeGitMenu } from "./utils/portals";
import { isProtectedRemoteBranch } from "./utils/branch-protection";

/** Both Git branch surfaces use the same actions and tracking submenus. */
export function addBranchMenu(menu, controller, snapshot, ref, remote, run = action => action()) {
    const current = snapshot.current;
    const busy = controller.busy || !controller.ready || menu.dom.ownerDocument !== controller.app.workspace.containerEl.ownerDocument;
    const local = snapshot.local.includes(current);
    const mutating = new Set(["checkout", "checkout-rebase", "new-branch", "merge", "rebase", "worktree", "pull-rebase", "pull-merge", "update", "rename", "delete"]);
    const add = (id, title, disabled = false) => menu.addItem(item => item.setTitle(title).setDisabled(busy || disabled || !!controller.operation && mutating.has(id))
        .onClick(() => run(() => controller.branchActions.run(id, ref, current, remote))));
    if (remote) {
        add("checkout", "Checkout");
        add("new-branch", `New Branch from '${ref}'...`);
        add("checkout-rebase", `Checkout and Rebase onto '${current}'`, !local);
        menu.addSeparator();
        add("compare", `Compare with '${current}'`, !local);
        add("working-diff", "Show Diff with Working Tree");
        menu.addSeparator();
        add("rebase", `Rebase '${current}' onto '${ref}'`, !local);
        add("merge", `Merge '${ref}' into '${current}'`, !local);
        menu.addSeparator();
        add("worktree", `New Worktree from '${ref}'...`);
        menu.addSeparator();
        add("pull-rebase", `Pull into '${current}' Using Rebase`, !local);
        add("pull-merge", `Pull into '${current}' Using Merge`, !local);
        menu.addSeparator();
        add("delete", "Delete Remote Branch…", isProtectedRemoteBranch(controller, ref, snapshot.remotes));
        return;
    }
    if (ref !== current) add("checkout", "Checkout");
    add("new-branch", `New Branch from '${ref}'...`);
    menu.addSeparator();
    add("working-diff", "Show Diff with Working Tree");
    if (ref !== current) {
        add("compare", `Compare with '${current}'`, !local);
        add("merge", `Merge '${ref}' into '${current}'`, !local);
        add("rebase", `Rebase '${current}' onto '${ref}'`, !local);
    }
    menu.addSeparator();
    add("worktree", `New Worktree from '${ref}'...`);
    menu.addSeparator();
    add("update", "Update", !snapshot.upstreams.get(ref));
    add("push", "Push...");
    const tracking = snapshot.upstreams.get(ref);
    if (tracking) menu.addItem(item => {
        item.setTitle(`Tracked Branch '${tracking}'`);
        const submenu = scopeGitMenu(item.setSubmenu(), menu.dom);
        addBranchMenu(submenu, controller, snapshot, tracking, true, run);
    });
    menu.addSeparator();
    add("rename", "Rename...");
    if (ref !== current) add("delete", "Delete");
}
