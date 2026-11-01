import { Notice } from "obsidian";
import { iconName } from "./icons";
import { scopeModule } from "./module-scope";

/** Render semantic actions into a granted menu; never inspect another provider's DOM. */
export function renderFileActions(menu, actions, owner, available = () => true) {
    const scopes = [];
    const append = (target, entries) => {
        for (const action of entries) {
            if (action.separatorBefore) target.addSeparator();
            target.addItem(item => {
                item.setTitle(action.label).setIcon(action.icon ? iconName(action.icon, owner) : "")
                    .setDisabled(!!action.disabledReason);
                if (action.children?.length) {
                    const submenu = item.setSubmenu();
                    scopes.push(scopeModule(submenu.dom, owner, { contribution: true, surface: "file-menu" }));
                    append(submenu, action.children);
                } else if (action.run) item.onClick(() => {
                    if (action.disabledReason || !available()) return;
                    void Promise.resolve().then(() => { if (available()) return action.run(); })
                        .catch(error => new Notice(error.message ?? "Could not complete the file action."));
                });
            });
        }
    };
    append(menu, actions);
    return { dispose() { for (const scope of scopes) scope.dispose(); scopes.length = 0; } };
}
