import { createHash } from "node:crypto";
import { Notice } from "obsidian";

/** Meld owns encryption and saving; Obsidian Keychain owns persistent passwords. */
export function installMeldPasswords(plugin) {
    const { app } = plugin;
    const storage = app.secretStorage;
    const hash = value => createHash("sha256").update(value).digest("hex");
    const prefix = `patchwork-meld-${hash(app.vault.adapter.getBasePath?.() ?? app.vault.getName()).slice(0, 16)}-`;
    const key = path => prefix + hash(path).slice(0, 32);
    const forget = path => {
        if (typeof storage.deleteSecret === "function") storage.deleteSecret(key(path));
        else storage.setSecret(key(path), "");
    };
    let locking = false;
    let binding;
    let disposed = false;
    let warned = false;
    const unavailable = () => {
        if (warned) return;
        warned = true;
        new Notice("Encrypted-note passwords could not be accessed in Keychain. Manual unlock is still available.");
    };
    const enabled = () => plugin.settings.rememberEncryptedPasswords === true;
    const remember = view => {
        if (!enabled() || locking || disposed || !view.file || !view.isSavingEnabled || view.isUnlocking
            || app.vault.getAbstractFileByPath(view.file.path) !== view.file) return;
        const password = view.passwordAndHint?.password;
        if (!password) return;
        const id = key(view.file.path);
        try {
            if (storage.getSecret(id) !== password) storage.setSecret(id, password);
        } catch { unavailable(); }
    };
    const clear = () => {
        for (const id of storage.listSecrets()) {
            if (!id.startsWith(prefix)) continue;
            if (typeof storage.deleteSecret === "function") storage.deleteSecret(id);
            else storage.setSecret(id, "");
        }
        app.commands.executeCommandById("meld-encrypt:clear-password-cache");
    };
    const sync = () => {
        if (disposed) return;
        // Named adapter for a separately installed provider, never a Patchwork sibling.
        const provider = app.plugins.plugins["meld-encrypt"];
        const feature = provider?.enabledFeatures?.find(item => typeof item.processLockAndCloseAllEncryptedNotesCommand === "function");
        if (binding?.feature !== feature) {
            binding?.restore(); binding = undefined;
            if (feature) {
                const original = feature.processLockAndCloseAllEncryptedNotesCommand;
                const lock = async function (...args) {
                    if (!enabled()) return original.apply(this, args);
                    if (locking) return;
                    locking = true;
                    try {
                        const leaves = app.workspace.getLeavesOfType("meld-encrypted-view");
                        for (const leaf of leaves) {
                            const view = leaf.view;
                            while (view.isSavingInProgress) await view.saveInProgress;
                            if (view.isSavingEnabled) await view.save();
                            if (leaf.view !== view) continue;
                            await leaf.setViewState({ type: "empty" });
                            view.passwordAndHint = null;
                            leaf.detach();
                        }
                        if (app.workspace.getLeavesOfType("meld-encrypted-view").length) throw new Error("An encrypted note opened during locking");
                        clear();
                    } catch {
                        new Notice("Could not save and lock every encrypted note. Saved passwords were retained; please try again.");
                    } finally { locking = false; }
                };
                feature.processLockAndCloseAllEncryptedNotesCommand = lock;
                binding = { feature, restore() {
                    if (feature.processLockAndCloseAllEncryptedNotesCommand === lock) feature.processLockAndCloseAllEncryptedNotesCommand = original;
                } };
            }
        }
        for (const leaf of app.workspace.getLeavesOfType("meld-encrypted-view")) remember(leaf.view);
    };
    plugin.registerEvent(app.workspace.on("layout-change", sync));
    plugin.registerEvent(app.vault.on("rename", (file, previous) => {
        if (!enabled() || file.extension !== "mdenc") return;
        const password = storage.getSecret(key(previous));
        if (!password) return;
        storage.setSecret(key(file.path), password);
        forget(previous);
    }));
    plugin.registerEvent(app.vault.on("delete", file => {
        if (enabled() && file.extension === "mdenc") forget(file.path);
    }));
    plugin.registerInterval(app.workspace.containerEl.ownerDocument.defaultView.setInterval(sync, 1000));
    plugin.register(() => { disposed = true; binding?.restore(); });
    app.workspace.onLayoutReady(sync);
    return {
        remember,
        recall(path) {
            if (!enabled() || locking || disposed) return null;
            try { return storage.getSecret(key(path)); }
            catch { unavailable(); return null; }
        },
    };
}
