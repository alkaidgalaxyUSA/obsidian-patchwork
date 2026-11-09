import { Notice } from "obsidian";
import { getWindowContext } from "../../../utils/windows";
import { installDoubleShift } from "./double-shift";
import { SearchEverywhereModal } from "./search-modal";

export function installSearchEverywhere(plugin) {
    const documents = new Map(), modals = new Map();
    const history = [];
    const lifetime = new AbortController();
    const open = document => {
        if (lifetime.signal.aborted || document.defaultView?.closed) return;
        if (modals.has(document)) { modals.get(document).input?.focus(); return; }
        if (document.querySelector(".modal-container")) return;
        try {
            const modal = new SearchEverywhereModal(plugin, getWindowContext(document), lifetime, () => modals.delete(document), history);
            modals.set(document, modal); modal.open(); modal.input?.focus();
        } catch (error) { modals.delete(document); new Notice(error.message); }
    };
    const attach = document => {
        if (!document?.defaultView || documents.has(document)) return;
        const stopKeys = installDoubleShift(document, () => open(document));
        const remove = () => {
            stopKeys(); modals.get(document)?.close(); documents.delete(document);
            document.defaultView.removeEventListener("unload", remove);
        };
        document.defaultView.addEventListener("unload", remove, { once: true });
        documents.set(document, remove);
    };
    const sync = () => {
        if (lifetime.signal.aborted) return;
        attach(plugin.app.workspace.containerEl.ownerDocument);
        plugin.app.workspace.iterateAllLeaves(leaf => attach(leaf.view.containerEl.ownerDocument));
    };
    plugin.registerEvent(plugin.app.workspace.on("layout-change", sync));
    plugin.registerEvent(plugin.app.workspace.on("window-open", sync));
    plugin.app.workspace.onLayoutReady(sync);
    plugin.addCommand({ id: "search-everywhere", name: "Search Everywhere", callback: () => {
        const document = plugin.app.workspace.activeLeaf?.view.containerEl.ownerDocument ?? plugin.app.workspace.containerEl.ownerDocument;
        open(document);
    } });
    plugin.register(() => {
        lifetime.abort();
        for (const remove of [...documents.values()]) remove();
        for (const modal of modals.values()) modal.close();
        modals.clear(); documents.clear(); history.length = 0;
    });
}
