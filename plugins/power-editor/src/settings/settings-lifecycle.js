/** Recreate the native Settings window while retaining plugin setting registrations. */
export function installSettingsLifecycle(plugin) {
    const { app } = plugin;
    let disposed = false;
    let attached;
    let originalClose;
    let wrappedClose;

    const createShell = (previous) => {
        // Native option-tab constructors subscribe globally. Their registrations already
        // exist on the retained tabs, so dispose the temporary constructor subscriptions.
        const subscriptions = [];
        const hooks = [];
        for (const emitter of new Set([app.workspace, app.commands, app.secretStorage, app.internalPlugins, app.plugins, app.vault, app.hotkeyManager])) {
            if (!emitter?.on || !emitter.offref) continue;
            const own = Object.getOwnPropertyDescriptor(emitter, "on");
            const original = emitter.on;
            emitter.on = function (...args) {
                const ref = original.apply(this, args);
                subscriptions.push([this, ref]);
                return ref;
            };
            hooks.push(() => { if (own) Object.defineProperty(emitter, "on", own); else delete emitter.on; });
        }
        let next;
        try { next = new previous.constructor(app); }
        finally {
            hooks.reverse().forEach((restore) => restore());
            subscriptions.forEach(([emitter, ref]) => emitter.offref(ref));
        }
        for (const tab of [...next.settingTabs, ...next.pluginTabs]) {
            next.removeSettingTab(tab);
            tab.navEl?.remove();
            tab.containerEl?.remove();
        }
        // Rebuild navigation nodes: their click handlers close over the owning window.
        for (const tab of [...previous.settingTabs, ...previous.pluginTabs]) {
            tab.navEl?.remove();
            tab.navEl = null;
            tab.setting = next;
            next.addSettingTab(tab);
        }
        previous.settingTabs.length = 0;
        previous.pluginTabs.length = 0;
        previous.containerEl.remove();
        previous.modalEl.remove();
        return next;
    };

    const attach = (setting) => {
        attached = setting;
        originalClose = setting.close;
        const close = originalClose;
        let replacing = false;
        wrappedClose = function (...args) {
            if (replacing) return;
            replacing = true;
            try {
                const result = close.apply(this, args);
                if (!disposed && app.setting === this) {
                    const next = createShell(this);
                    this.close = close;
                    app.setting = next;
                    attach(next);
                }
                return result;
            } finally { replacing = false; }
        };
        setting.close = wrappedClose;
    };
    attach(app.setting);
    plugin.register(() => {
        disposed = true;
        if (attached.close === wrappedClose) attached.close = originalClose;
    });
}
