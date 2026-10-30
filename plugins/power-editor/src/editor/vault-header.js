import { setIcon } from "../../../utils/icons";
import { GitPopup } from "./git-popup";

/** Keep the native vault switcher and delegate repository actions to Patchwork Git. */
export class VaultHeader {
    constructor(app, doc) {
        this.app = app;
        this.doc = doc;
        this.revision = 0;
        this.refs = ["patchwork-git:refreshed"]
            .map((event) => app.workspace.on(event, () => this.refreshBranch()));
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
            this.badge.setAttribute("aria-hidden", "true");
            this.button = this.doc.createElement("button");
            this.button.type = "button";
            this.button.className = "pw-vault-git";
            this.button.setAttribute("aria-haspopup", "menu");
            this.button.setAttribute("aria-expanded", "false");
            this.button.setAttribute("data-tooltip-position", "bottom");
            const icon = this.doc.createElement("span");
            setIcon(icon, "git-branch-flipped");
            this.label = this.doc.createElement("span");
            this.label.className = "pw-vault-git-label";
            const arrow = this.doc.createElement("span");
            arrow.className = "pw-header-chevron";
            this.button.append(icon, this.label, arrow);
            this.button.addEventListener("click", () => this.openMenu());
        }
        const name = this.app.vault.getName();
        const words = name.split(/[\s._-]+/).filter(Boolean);
        this.badge.textContent = (words.length > 1 ? words.slice(0, 2).map((word) => [...word][0]).join("") : [...name].slice(0, 2).join("")).toUpperCase();
        if (this.badge.parentElement !== switcher) switcher.prepend(this.badge);
        if (switcher.nextElementSibling !== this.button) switcher.after(this.button);
        const git = this.app.plugins.plugins["patchwork-git"];
        if (this.git !== git || this.ready !== !!git?.gitReady) {
            this.git = git;
            this.ready = !!git?.gitReady;
            void this.refreshBranch();
        }
    }

    async refreshBranch() {
        const revision = ++this.revision;
        const git = this.app.plugins.plugins["patchwork-git"];
        let branch = "Git";
        if (git?.gitReady) {
            try { branch = await git.repository.branch() || "Detached HEAD"; }
            catch {
                try { branch = `Detached ${String(await git.repository.run(["rev-parse", "--short", "HEAD"])).trim()}`; }
                catch { branch = "Git"; }
            }
        }
        if (this.disposed || revision !== this.revision || !this.label) return;
        this.label.textContent = branch;
        this.button.setAttribute("aria-label", git ? `Git: ${branch}` : "Enable Patchwork Git to use repository actions");
        void this.menu?.load();
    }

    openMenu() {
        if (this.menu) { this.menu.close(); return; }
        this.menu = new GitPopup(this.app, this.button, () => { this.menu = undefined; });
        this.menu.open();
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
        if (this.switcherTooltipPosition === null) this.switcher.removeAttribute("data-tooltip-position");
        else this.switcher.setAttribute("data-tooltip-position", this.switcherTooltipPosition);
        this.switcher = undefined;
    }

    dispose() {
        this.disposed = true;
        this.menu?.close();
        this.restoreSwitcherTooltip();
        this.logo?.remove();
        this.logo = undefined;
        for (const ref of this.refs) this.app.workspace.offref(ref);
        this.badge?.remove();
        this.button?.remove();
    }
}
