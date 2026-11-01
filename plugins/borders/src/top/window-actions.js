import { scopeModule } from "../../../utils/module-scope";
import { setIcon } from "../utils/icons";
import { NativeControls } from "../utils/native-controls";
import { VaultHeader } from "./vault-header";

const SHORTCUTS = ["meld-encrypt:Lock and close all open encrypted notes", "obsidian-excalidraw-plugin:New drawing"];

/** Window chrome only. Features receive dedicated header slots. */
export class WindowActions {
    constructor(app, doc) {
        this.app = app; this.doc = doc; this.native = new NativeControls();
        this.vault = new VaultHeader(app, doc);
        this.slots = new Map(); this.leases = new Map();
        this.shortcutKeys = new Map();
    }

    sync() {
        const titlebar = this.doc.querySelector(".titlebar");
        const controls = titlebar?.querySelector(".titlebar-button-container.mod-right");
        const minimize = controls?.querySelector(".mod-minimize");
        if (!titlebar || !controls || !minimize) return;
        if (!this.titlebar) {
            this.titlebar = titlebar;
            this.titlebarMarker = this.doc.createComment("Patchwork titlebar position"); titlebar.before(this.titlebarMarker);
            this.doc.body.append(titlebar);
            this.toolbar = this.doc.createElement("div"); this.toolbar.className = "pw-titlebar-shortcuts";
            this.scope = scopeModule(this.toolbar, "borders", { border: "top" });
            this.toolbar.setAttribute("role", "toolbar"); this.toolbar.setAttribute("aria-label", "Titlebar shortcuts");
            controls.insertBefore(this.toolbar, minimize);
            this.previousSpace = this.doc.body.style.getPropertyValue("--pw-window-tools-right-space");
            this.previousSpacePriority = this.doc.body.style.getPropertyPriority("--pw-window-tools-right-space");
            this.previousHeader = this.doc.body.style.getPropertyValue("--pw-document-header-height");
        }
        const items = new Map((this.app.workspace.leftRibbon?.items ?? []).map(item => [item.id, item.buttonEl]));
        for (const id of SHORTCUTS) {
            const button = items.get(id); if (!button || button.ownerDocument !== this.doc) continue;
            this.native.move(button, this.toolbar, { "data-tooltip-position": "bottom", role: "button", tabindex: "0" });
            if (!this.shortcutKeys.has(button) && button.tagName !== "BUTTON") {
                const keydown = event => { if (["Enter", " "].includes(event.key)) { event.preventDefault(); button.click(); } };
                button.addEventListener("keydown", keydown); this.shortcutKeys.set(button, keydown);
            }
        }
        const settings = this.doc.querySelector(".workspace-drawer-vault-actions .clickable-icon:has(.lucide-settings)") ?? this.settings?.button;
        if (settings && settings !== this.settings?.button) {
            this.restoreSettings();
            const entry = this.native.move(settings, controls, { "data-tooltip-position": "bottom", role: "button", tabindex: "0", "aria-label": "Settings" }, button => setIcon(button, "settings"));
            const previousClass = settings.classList.contains("pw-window-settings"); settings.classList.add("pw-window-settings");
            const click = event => { event.preventDefault(); event.stopImmediatePropagation(); this.app.setting?.open(); };
            const keydown = event => { if (["Enter", " "].includes(event.key)) { event.preventDefault(); settings.click(); } };
            settings.addEventListener("click", click, true); settings.addEventListener("keydown", keydown);
            this.settings = { button: settings, entry, previousClass, click, keydown };
        }
        if (this.settings && this.settings.button.nextSibling !== minimize) controls.insertBefore(this.settings.button, minimize);
        const next = this.settings?.button ?? minimize;
        if (this.toolbar.nextSibling !== next) controls.insertBefore(this.toolbar, next);
        this.vault.sync();
        const profile = this.doc.querySelector(".mod-left-split > .workspace-sidedock-vault-profile");
        const height = profile?.getBoundingClientRect().height;
        if (height > 0) this.doc.body.style.setProperty("--pw-document-header-height", `${height}px`);
        const bounds = controls.getBoundingClientRect();
        this.doc.body.style.setProperty("--pw-window-tools-right-space", `${Math.ceil(this.doc.defaultView.innerWidth - bounds.left) + 4}px`);
        for (const lease of this.leases.values()) lease.sync();
    }

    mount(id, contribution, context) {
        this.vault.sync();
        const parent = this.vault.switcher?.parentElement;
        if (!parent) return false;
        const host = this.doc.createElement("span"); host.className = "pw-header-slot";
        const scope = scopeModule(host, "borders", { border: "top" });
        const content = host.createSpan();
        const ownerScope = scopeModule(content, contribution.owner, { contribution: true });
        this.vault.switcher.after(host);
        let mounted;
        try { mounted = contribution.mount(content, context); }
        catch (error) { ownerScope.dispose(); scope.dispose(); host.remove(); throw error; }
        this.slots.set(id, { host, mounted, scope, ownerScope, order: contribution.order });
        let previous = this.vault.switcher;
        for (const slot of [...this.slots.values()].sort((a, b) => a.order - b.order)) { previous.after(slot.host); previous = slot.host; }
        return true;
    }

    unmount(id) {
        const slot = this.slots.get(id); if (!slot) return;
        this.slots.delete(id);
        try { slot.mounted.dispose(); }
        catch (error) { console.error("Patchwork header cleanup failed.", error); }
        finally { slot.ownerScope.dispose(); slot.scope.dispose(); slot.host.remove(); }
    }

    restoreSettings() {
        const settings = this.settings; if (!settings) return;
        settings.button.removeEventListener("click", settings.click, true); settings.button.removeEventListener("keydown", settings.keydown);
        if (!settings.previousClass) settings.button.classList.remove("pw-window-settings");
        this.native.release(settings.button); this.settings = undefined;
    }

    dispose() {
        for (const id of this.slots.keys()) this.unmount(id);
        for (const lease of this.leases.values()) lease.dispose(); this.leases.clear();
        for (const [button, keydown] of this.shortcutKeys) button.removeEventListener("keydown", keydown);
        this.shortcutKeys.clear();
        this.restoreSettings(); this.native.dispose(); this.vault.dispose(); this.scope?.dispose(); this.toolbar?.remove();
        if (this.titlebarMarker?.parentNode && this.titlebar.parentElement === this.doc.body) this.titlebarMarker.replaceWith(this.titlebar);
        if (!this.titlebar) return;
        for (const [name, value, priority] of [["--pw-window-tools-right-space", this.previousSpace, this.previousSpacePriority], ["--pw-document-header-height", this.previousHeader, ""]]) {
            if (value) this.doc.body.style.setProperty(name, value, priority); else this.doc.body.style.removeProperty(name);
        }
    }
}
