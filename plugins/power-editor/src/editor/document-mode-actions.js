import { Notice, setTooltip } from "obsidian";
import { setIcon } from "../../../utils/icons";

function isEditableDocument(view) {
    if (!view?.file) return false;
    if (view.getViewType() === "markdown") return true;
    return view.getViewType() === "meld-encrypted-view"
        && view.isSavingEnabled === true && view.isUnlocking === false && view.isLoadingFileInProgress === false;
}

/** A document-local edit/save action; native views continue to own persistence. */
export function installDocumentModeActions(plugin) {
    const { app } = plugin;
    const entries = new Map();
    let disposed = false;
    let pending = false;

    const render = (entry) => {
        const { view, button } = entry;
        const available = isEditableDocument(view);
        button.hidden = !available;
        if (!available) return;
        const editing = view.getMode() === "source";
        const label = entry.busy ? (editing ? "Saving…" : "Opening editor…") : (editing ? "Save" : "Edit");
        if (entry.editing !== editing) {
            entry.editing = editing;
            button.classList.toggle("is-editing", editing);
            setIcon(button, editing ? "save" : "pencil");
        }
        if (button.getAttribute("aria-label") !== label) setTooltip(button, label, { placement: "left" });
        button.disabled = entry.busy;
        button.setAttribute("aria-busy", String(entry.busy));
    };

    const activate = async (entry) => {
        const { view } = entry;
        const file = view.file;
        if (entry.busy || !file || !isEditableDocument(view)) return;
        const current = () => !disposed && view.leaf.view === view && view.file === file
            && view.containerEl.isConnected && isEditableDocument(view);
        entry.busy = true;
        render(entry);
        try {
            if (view.getMode() === "preview") {
                await view.setState({ ...view.getState(), mode: "source" }, { history: false });
                if (current()) app.workspace.setActiveLeaf(view.leaf, { focus: true });
                return;
            }
            const win = view.containerEl.ownerDocument.defaultView;
            const deadline = Date.now() + 15000;
            const wait = async () => {
                if (Date.now() >= deadline) throw new Error("Save timed out");
                await new Promise(resolve => win.setTimeout(resolve, 25));
            };
            // A concurrent native save can return early. Wait for it and any title
            // rename before asking the view to persist the latest document state.
            const saving = () => view.saving || view.isSavingInProgress
                || plugin.noteTitle.records.get(file)?.running;
            do {
                while (current() && saving()) await wait();
                if (!current()) return;
                await view.save();
                while (current() && saving()) await wait();
                if (!current()) return;
                const changed = view.getViewType() === "meld-encrypted-view"
                    ? view.dataWasChangedSinceLastSave : view.dirty;
                if (!changed) break;
                await wait();
            } while (current());
            // Never write editor text directly: Meld must encrypt .mdenc saves.
            if (current()) await view.setState({ ...view.getState(), mode: "preview" }, { history: false });
        } catch {
            if (current()) new Notice(view.getMode() === "source"
                ? "Could not save this note. Editing mode has been kept; please try again."
                : "Could not open the editor. Please try again.");
        } finally {
            entry.busy = false;
            render(entry);
        }
    };

    const attach = (view) => {
        const doc = view.containerEl.ownerDocument;
        // A hot reload can leave a prior action behind if Obsidian is rebuilding
        // this leaf at the same time. Keep exactly one live control per document.
        view.containerEl.querySelectorAll(":scope > .pw-document-mode-action").forEach(element => element.remove());
        const button = doc.createElement("button");
        button.type = "button";
        button.className = "clickable-icon pw-document-mode-action";
        const entry = { view, button, busy: false };
        button.addEventListener("click", () => void activate(entry));
        // A sibling of the scrolling content stays in the document's upper-right corner.
        view.containerEl.append(button);
        const observer = new doc.defaultView.MutationObserver(() => render(entry));
        observer.observe(view.containerEl, { attributes: true, attributeFilter: ["data-mode", "class"] });
        entry.cleanup = () => { observer.disconnect(); button.remove(); };
        entries.set(view, entry);
        render(entry);
    };

    const refresh = () => {
        pending = false;
        if (disposed) return;
        const views = new Set();
        app.workspace.iterateAllLeaves(leaf => {
            const view = leaf.view;
            if (["markdown", "meld-encrypted-view"].includes(view.getViewType())
                && view.containerEl.closest(".mod-root")) views.add(view);
        });
        for (const [view, entry] of entries) {
            if (views.has(view)) continue;
            entry.cleanup();
            entries.delete(view);
        }
        for (const view of views) {
            const entry = entries.get(view);
            if (entry) {
                if (!entry.button.isConnected) view.containerEl.append(entry.button);
                render(entry);
            } else attach(view);
        }
    };
    const schedule = () => {
        if (disposed || pending) return;
        pending = true;
        queueMicrotask(refresh);
    };
    for (const event of ["layout-change", "active-leaf-change", "file-open", "window-open"]) {
        plugin.registerEvent(app.workspace.on(event, schedule));
    }
    app.workspace.onLayoutReady(schedule);
    refresh();
    plugin.register(() => {
        disposed = true;
        for (const entry of entries.values()) entry.cleanup();
        entries.clear();
    });
}
