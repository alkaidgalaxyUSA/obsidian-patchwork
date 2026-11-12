import { Platform } from "obsidian";
import { getServiceRegistry } from "../../../utils/service-registry";
import { getWindowContext } from "../../../utils/windows";
import { renderFileActions } from "../../../utils/file-menu-actions";

/** IDEA-style file and layout actions; optional providers own their semantics. */
export function appendDocumentTabActions(menu, leaf, operations, run) {
    const { app } = operations;
    const doc = leaf.view.containerEl.ownerDocument;
    const file = leaf.view.file;
    const registry = getServiceRegistry(app);
    const context = getWindowContext(doc);
    const add = (target, title, action, disabled = false) => target.addItem(item => item.setTitle(title)
        .setDisabled(disabled).onClick(() => run(action)));
    const submenu = (target, title, build) => target.addItem(item => {
        item.setTitle(title);
        const child = item.setSubmenu();
        child.dom.classList.add("pw-document-tab-context-menu");
        build(child);
    });
    if (file) {
        menu.addSeparator();
        submenu(menu, "Copy Path / Reference", child => {
            const copy = text => doc.defaultView.navigator.clipboard.writeText(text);
            add(child, "Absolute Path", () => copy(app.vault.adapter.getFullPath(file.path)), !app.vault.adapter.getFullPath);
            add(child, "Path from Project Root", () => copy(file.path));
            add(child, "File Name", () => copy(file.name));
            add(child, "Obsidian Link", () => copy(`obsidian://open?vault=${encodeURIComponent(app.vault.getName())}&file=${encodeURIComponent(file.path)}`));
        });
        menu.addSeparator();
        for (const [direction, label] of [["vertical", "Right"], ["horizontal", "Down"]]) {
            add(menu, `Split ${label}`, () => operations.open(leaf, { direction }));
            add(menu, `Move ${label}`, () => operations.open(leaf, { direction, move: true }), leaf.parent.children.length < 2);
        }
        const groups = operations.groups(leaf);
        for (const [move, title] of [[false, "Open in Other Group"], [true, "Move to Other Group"]]) {
            if (groups.length <= 1) add(menu, title, () => operations.open(leaf, { group: groups[0], move }), !groups.length);
            else submenu(menu, title, child => groups.forEach((group, index) => {
                const name = group.children[group.currentTab]?.view.getDisplayText() ?? "Editor";
                add(child, `Group ${index + 1}: ${name}`, () => operations.open(leaf, { group, move }));
            }));
        }
        if (Platform.isDesktopApp) add(menu, "Open in New Window", () => app.workspace.moveLeafToPopout(leaf));
    }
    menu.addSeparator();
    if (leaf.canPin()) add(menu, leaf.pinned ? "Unpin" : "Pin", () => leaf.togglePinned());
    add(menu, "Reopen Closed Tab", () => operations.reopen(leaf), !operations.history.peek(doc));
    if (!file) return;
    menu.addSeparator();
    add(menu, "Rename", () => app.fileManager.promptForFileRename(file));
    const project = registry.get("project");
    add(menu, "Select in Project View", () => {
        if (registry.get("project") !== project) throw new Error("Project is unavailable. Open the menu again.");
        return project.reveal(file.path, context);
    }, !project);
    if (Platform.isDesktopApp) add(menu, "Open in Explorer", () => app.showInFolder(file.path));
    menu.addSeparator();
    const git = registry.get("git");
    if (!git) { add(menu, "Git", () => {}, true); return; }
    const path = file.path;
    const actions = git.buildFileActions({ ...context, targets: [{ path, kind: "file" }], source: "document" });
    const mounted = renderFileActions(menu, actions, "git", () => !operations.disposed
        && registry.get("git") === git && app.workspace.isAttached(leaf)
        && leaf.view.containerEl.ownerDocument === doc && !doc.defaultView.closed && leaf.view.file?.path === path);
    menu.onHide(() => mounted.dispose());
}
