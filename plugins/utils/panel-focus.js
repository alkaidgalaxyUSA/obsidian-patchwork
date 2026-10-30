/** Track panel interaction, including clicks on controls that do not take DOM focus. */
export class PanelFocus {
    constructor(plugin, entries) {
        this.entries = entries;
        this.doc = plugin.app.workspace.containerEl.ownerDocument;
        this.focused = this.resolve(this.doc.activeElement);
        const interact = event => {
            this.focused = this.resolve(event.target);
            this.sync();
        };
        plugin.registerDomEvent(this.doc, "pointerdown", interact, true);
        plugin.registerDomEvent(this.doc, "focusin", interact, true);
        plugin.registerDomEvent(this.doc.defaultView, "blur", () => this.sync(false));
        plugin.registerDomEvent(this.doc.defaultView, "focus", () => {
            if (this.doc.activeElement !== this.doc.body) this.focused = this.resolve(this.doc.activeElement);
            this.sync();
        });
        plugin.register(() => {
            for (const { button } of this.entries()) button?.removeAttribute("data-pw-panel-focused");
        });
    }

    resolve(target) {
        return this.entries().find(({ button, leaves }) => button?.contains(target)
            || leaves.some(leaf => leaf.view.containerEl.contains(target)))?.id;
    }

    sync(windowFocused = this.doc.hasFocus()) {
        for (const { id, button } of this.entries()) {
            if (!button) continue;
            const focused = windowFocused && id === this.focused && button.getAttribute("aria-pressed") === "true";
            button.setAttribute("data-pw-panel-focused", String(focused));
        }
    }
}
