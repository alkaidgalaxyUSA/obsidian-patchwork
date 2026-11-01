import { scopeModule } from "../../../utils/module-scope";

export function scopeGitMenu(menu, source) {
    const scope = scopeModule(menu.dom, "git", { surface: "menu" });
    if (source) scope.refreshTokens(source);
    menu.onHide(() => scope.dispose());
    return menu;
}

/** Keep owned dialogs scoped and close them with their controller. */
export function openGitDialog(controller, modal) {
    const scope = scopeModule(modal.modalEl, "git", { surface: "dialog" });
    const onClose = modal.onClose.bind(modal);
    controller.dialogs.add(modal);
    modal.onClose = () => {
        controller.dialogs.delete(modal);
        scope.dispose();
        onClose();
    };
    modal.open();
}
