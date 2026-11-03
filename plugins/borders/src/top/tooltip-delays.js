/** Lease native tooltip delays before Obsidian's bubbling pointer handler runs. */
export class TooltipDelays {
    constructor(doc) {
        this.doc = doc;
        this.leases = new Map();
        this.over = event => {
            const target = event.target?.closest?.("[aria-label]");
            if (!target) return;
            const owner = target.closest("[data-pw-module]");
            const owned = owner?.getAttribute("data-pw-module") === "borders" && owner.hasAttribute("data-pw-border");
            const native = !owner && target.matches(".pw-window-settings, .titlebar-button, .workspace-drawer-vault-switcher");
            if (!owned && !native) return;
            for (const element of this.leases.keys()) if (!element.isConnected) this.restore(element);
            if (target.getAttribute("data-tooltip-delay") === "0") return;
            this.leases.set(target, target.getAttribute("data-tooltip-delay"));
            target.setAttribute("data-tooltip-delay", "0");
        };
        doc.addEventListener("pointerover", this.over, true);
    }

    restore(element) {
        const previous = this.leases.get(element);
        this.leases.delete(element);
        if (element.getAttribute("data-tooltip-delay") !== "0") return;
        if (previous === null) element.removeAttribute("data-tooltip-delay");
        else element.setAttribute("data-tooltip-delay", previous);
    }

    dispose() {
        this.doc.removeEventListener("pointerover", this.over, true);
        for (const element of this.leases.keys()) this.restore(element);
    }
}
