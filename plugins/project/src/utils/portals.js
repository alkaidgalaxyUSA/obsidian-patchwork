import { scopeModule } from "../../../utils/module-scope";

/** Tag only Project-created modal roots and restore their metadata on close. */
export function scopeProjectModal(modal, source) {
    const scope = scopeModule(modal.modalEl, "project", { surface: "dialog" });
    const origin = source ?? modal.modalEl.ownerDocument.querySelector('[data-pw-module="project"][data-type="file-explorer"]');
    if (origin) scope.refreshTokens(origin);
    const close = modal.onClose.bind(modal);
    modal.onClose = () => { try { close(); } finally { scope.dispose(); } };
}
