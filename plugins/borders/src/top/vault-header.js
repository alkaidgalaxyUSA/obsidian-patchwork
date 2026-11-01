import { scopeModule } from "../../../utils/module-scope";

/** Native logo, vault badge, and switcher presentation only. */
export class VaultHeader {
    constructor(app, doc) {
        this.app = app;
        this.doc = doc;

    }

    sync() {
        this.syncLogo();
        const switcher = this.doc.querySelector(".workspace-drawer-vault-switcher");
        if (!switcher) return;
        if (this.switcher !== switcher) {
            this.restoreSwitcherTooltip();
            this.switcher = switcher;
            this.switcherTooltipPosition = switcher.getAttribute("data-tooltip-position");
        }
        switcher.setAttribute("data-tooltip-position", "bottom");
        if (!this.badge) {
            this.badge = this.doc.createElement("span");
            this.badge.className = "pw-vault-badge";
            this.badgeScope = scopeModule(this.badge, "borders", { border: "top" });
            this.badge.setAttribute("aria-hidden", "true");

        }
        const name = this.app.vault.getName();
        const words = name.split(/[\s._-]+/).filter(Boolean);
        const label = (words.length > 1 ? words.slice(0, 2).map((word) => [...word][0]).join("") : [...name].slice(0, 2).join("")).toUpperCase();
        if (this.badge.textContent !== label) this.badge.textContent = label;
        if (this.badge.parentElement !== switcher) switcher.prepend(this.badge);
    }

    syncLogo() {
        if (this.logo) return;
        const original = this.doc.querySelector(".titlebar-button.mod-logo .logo-full");
        if (!original) return;
        const svg = original.cloneNode(true);
        const ids = new Map([...svg.querySelectorAll("[id]")].map((element) => {
            const id = element.id;
            element.id = `pw-app-${id}`;
            return [id, element.id];
        }));
        for (const attribute of [...svg.querySelectorAll("*")].flatMap((element) => [...element.attributes])) {
            attribute.value = attribute.value.replace(/url\(#([^)]+)\)/g, (value, id) => ids.has(id) ? `url(#${ids.get(id)})` : value);
        }
        const logo = this.doc.createElement("span");
        logo.className = "pw-app-logo";
        this.logoScope = scopeModule(logo, "borders", { border: "top" });
        logo.setAttribute("aria-hidden", "true");
        logo.append(svg);
        for (const type of ["click", "dblclick", "contextmenu"]) {
            logo.addEventListener(type, (event) => { event.preventDefault(); event.stopPropagation(); });
        }
        this.doc.body.append(logo);
        this.logo = logo;
    }

    restoreSwitcherTooltip() {
        if (!this.switcher) return;
        if (this.switcher.getAttribute("data-tooltip-position") !== "bottom") { this.switcher = undefined; return; }
        if (this.switcherTooltipPosition === null) this.switcher.removeAttribute("data-tooltip-position");
        else this.switcher.setAttribute("data-tooltip-position", this.switcherTooltipPosition);
        this.switcher = undefined;
    }

    dispose() {
        this.disposed = true;
        this.restoreSwitcherTooltip();
        this.logoScope?.dispose(); this.badgeScope?.dispose();
        this.logo?.remove();
        this.logo = undefined;
        this.badge?.remove();
    }
}
