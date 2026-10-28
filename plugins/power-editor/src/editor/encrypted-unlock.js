import { Modal, WorkspaceLeaf } from "obsidian";

/** Keep a document-local locked state; Meld still owns password verification and decryption. */
export function installEncryptedUnlock(plugin) {
    const { app } = plugin;
    const entries = new Map();
    const originalOpen = Modal.prototype.open;
    const originalSetState = WorkspaceLeaf.prototype.setViewState;
    const pendingLoads = new WeakMap();
    let disposed = false;

    const trackLoad = function (state, ...args) {
        const opening = state.type === "meld-encrypted-view" && state.state?.file !== this.view.file?.path;
        const result = originalSetState.call(this, state, ...args);
        if (!opening) return result;
        const pending = Promise.resolve(result).finally(() => {
            if (pendingLoads.get(this) === pending) pendingLoads.delete(this);
        });
        pendingLoads.set(this, pending);
        return pending;
    };
    WorkspaceLeaf.prototype.setViewState = trackLoad;

    const createPage = (view) => {
        const leaf = view.leaf;
        const file = view.file;
        const entry = { view, leaf, file, closed: false, restores: [], prompt: null, attempted: false };
        const host = view.contentEl.createDiv({ cls: "pw-encrypted-unlock", attr: { role: "region", "aria-label": "Unlock encrypted note" } });
        const form = host.createEl("form", { cls: "pw-encrypted-unlock-form" });
        const label = form.createEl("label", { cls: "pw-encrypted-unlock-label", text: "Password" });
        const controls = form.createDiv({ cls: "pw-encrypted-unlock-controls" });
        const input = controls.createEl("input", { type: "password", attr: { autocomplete: "current-password", "aria-label": "Password" } });
        input.id = `pw-unlock-${crypto.randomUUID()}`;
        label.htmlFor = input.id;
        const button = controls.createEl("button", { text: "Decrypt", type: "submit", cls: "mod-cta" });
        const status = form.createDiv({ cls: "pw-encrypted-unlock-status", attr: { role: "status", "aria-live": "polite" } });
        status.hidden = true;
        view.contentEl.classList.add("pw-encrypted-unlock-host");
        const replace = (target, key, method) => {
            const descriptor = Object.getOwnPropertyDescriptor(target, key);
            target[key] = method;
            entry.restores.push(() => {
                if (target[key] !== method) return;
                if (descriptor) Object.defineProperty(target, key, descriptor);
                else delete target[key];
            });
        };
        const cleanup = () => {
            if (entry.closed) return false;
            entry.closed = true;
            entries.delete(view);
            entry.restores.reverse().forEach((restore) => restore());
            view.contentEl.classList.remove("pw-encrypted-unlock-host");
            input.value = "";
            host.remove();
            return true;
        };
        const settlePrompt = (confirmed) => {
            const prompt = entry.prompt;
            if (!prompt) return;
            entry.prompt = null;
            prompt.restore();
            prompt.modal.isOpen = false;
            prompt.modal.resultConfirmed = confirmed;
            if (!confirmed) prompt.modal.resultPassword = { password: "", hint: "" };
            prompt.modal.onClose();
        };
        entry.cancel = () => {
            // An obsolete unlock must not detach a leaf that is opening another note.
            if (entry.closed) return;
            view.viewDataRequest++;
            view.isUnlocking = false;
            cleanup();
            settlePrompt(false);
            view.setViewBusy(false);
        };
        entry.restore = () => {
            const prompt = entry.prompt;
            cleanup();
            if (!prompt) return;
            entry.prompt = null;
            prompt.restore();
            prompt.modal.isOpen = false;
            originalOpen.call(prompt.modal);
        };
        entry.bindPrompt = (modal) => {
            const descriptor = Object.getOwnPropertyDescriptor(modal, "close");
            const close = () => entry.cancel();
            modal.close = close;
            modal.isOpen = true;
            modal.resultConfirmed = false;
            entry.prompt = { modal, restore: () => {
                if (modal.close !== close) return;
                if (descriptor) Object.defineProperty(modal, "close", descriptor);
                else delete modal.close;
            } };
            input.disabled = false;
            button.disabled = false;
            form.setAttribute("aria-busy", "false");
            input.setAttribute("aria-invalid", String(entry.attempted));
            status.hidden = !entry.attempted;
            status.textContent = entry.attempted ? "Incorrect password. Try again." : "";
            // A retry in a background tab must not steal focus from another document.
            if (app.workspace.activeLeaf === leaf) input.focus();
        };
        form.addEventListener("submit", (event) => {
            event.preventDefault();
            if (entry.closed || !entry.prompt || button.disabled) return;
            entry.attempted = true;
            entry.prompt.modal.resultPassword = { password: input.value, hint: entry.prompt.modal.defaultPassword?.hint ?? "" };
            input.value = "";
            input.disabled = true;
            button.disabled = true;
            form.setAttribute("aria-busy", "true");
            status.hidden = true;
            // Resolve only the password request, not the locked page. A failed
            // verification binds Meld's next request to this very same form.
            settlePrompt(true);
        });
        input.addEventListener("keydown", (event) => {
            if (event.key === "Enter" && event.isComposing) event.preventDefault();
        });
        const setViewBusy = view.setViewBusy;
        replace(view, "setViewBusy", function (busy) {
            const result = setViewBusy.call(this, busy);
            if (busy || this.isUnlocking || entry.closed) return result;
            if (this.isSavingEnabled) cleanup();
            else {
                form.setAttribute("aria-busy", "false");
                input.disabled = true;
                button.disabled = true;
                status.hidden = false;
                status.textContent = "Unable to unlock this note. Reopen it to try again.";
            }
            return result;
        });
        const setViewState = leaf.setViewState;
        replace(leaf, "setViewState", function (state, ...args) {
            if (state.type !== view.getViewType() || (state.state?.file && state.state.file !== file.path)) {
                const pending = pendingLoads.get(this);
                entry.cancel();
                // Let the previous encrypted setState finish its save-state cleanup
                // before another document starts loading into the same view.
                if (pending) return pending.catch(() => {}).then(() => setViewState.call(this, state, ...args));
            }
            return setViewState.call(this, state, ...args);
        });
        const detach = leaf.detach;
        replace(leaf, "detach", function (...args) {
            entry.cancel();
            return detach.apply(this, args);
        });
        entries.set(view, entry);
        return entry;
    };

    const open = function (...args) {
        if (disposed || this.app !== app || this.isEncrypting !== false || this.confirmPassword !== false
            || typeof this.open2Async !== "function" || typeof this.title !== "string") return originalOpen.apply(this, args);
        const candidates = app.workspace.getLeavesOfType("meld-encrypted-view").map((leaf) => leaf.view)
            .filter((view) => view.file && view.isUnlocking === true && typeof view.viewDataRequest === "number"
                && !entries.get(view)?.prompt && this.title === `Decrypt "${view.file.basename}"`);
        // Never associate an ambiguous prompt with the wrong encrypted document.
        if (candidates.length !== 1) return originalOpen.apply(this, args);
        const view = candidates[0];
        const entry = entries.get(view) ?? createPage(view);
        entry.bindPrompt(this);
    };
    Modal.prototype.open = open;
    plugin.registerEvent(app.workspace.on("layout-change", () => {
        for (const entry of entries.values()) {
            if (!entry.view.containerEl.isConnected || entry.leaf.view !== entry.view) entry.cancel();
        }
    }));
    plugin.register(() => {
        disposed = true;
        if (Modal.prototype.open === open) Modal.prototype.open = originalOpen;
        if (WorkspaceLeaf.prototype.setViewState === trackLoad) WorkspaceLeaf.prototype.setViewState = originalSetState;
        for (const entry of [...entries.values()]) {
            // If the adapter is disabled, continue the same unlock using Meld's native UI.
            entry.restore();
        }
    });
}
