import { LANGUAGES, THEMES, FONT_SIZES } from "./utils/note-code-block.js";
import { HEADINGS, BASIC_BLOCKS, RICH_BLOCKS, INSERT_GROUPS } from "./utils/block-formats.js";

class NoteCodeMenus {
    constructor({ setIcon, Notice }) {
        this.setIcon = setIcon;
        this.Notice = Notice;
        this.tooltipObservers = new Map();
    }

    observeTooltips(doc) {
        if (this.tooltipObservers.has(doc)) return;
        const observer = new doc.defaultView.MutationObserver((mutations) => {
            for (const mutation of mutations) for (const node of mutation.addedNodes) {
                const element = node.nodeType === 1 ? node : node.parentElement;
                const tooltip = element?.closest?.(".tooltip");
                if (!tooltip) continue;
                const label = tooltip.textContent.trim().toLowerCase();
                if (["can drag and click", "adaptive width display"].includes(label)) tooltip.classList.add("pw-code-tooltip");
            }
        });
        observer.observe(doc.body, { childList: true, subtree: true });
        this.tooltipObservers.set(doc, observer);
    }

    open(header, trigger, binding, setting) {
        if (this.disposed) return;
        if (this.trigger === trigger) { this.close(); return; }
        this.close(false);
        const doc = header.ownerDocument;
        for (const bubble of doc.querySelectorAll(".ped-bubble")) bubble.style.display = "none";
        this.header = header;
        this.trigger = trigger;
        this.binding = binding;
        header.dataset.menuOpen = "true";
        const panel = doc.createElement("div");
        panel.className = "pw-code-popover";
        panel.dataset.menu = setting || "settings";
        panel.setAttribute("aria-label", trigger.getAttribute("aria-label"));
        panel.setAttribute("role", "dialog");
        this.panel = panel;
        doc.body.append(panel);
        trigger.setAttribute("aria-expanded", "true");
        if (setting === "block") this.renderBlockMenu();
        else if (setting) this.renderChoices(setting, setting === "language" ? LANGUAGES : THEMES, false);
        else this.renderSettings();
        this.position();
        panel.querySelector('[aria-selected="true"], button')?.focus({ preventScroll: true });
        panel.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
        const outside = (event) => {
            if (!panel.contains(event.target) && !this.panel?.contains(event.target) && !trigger.contains(event.target)) this.close(false);
        };
        const scroll = (event) => {
            if (!panel.contains(event.target) && !this.panel?.contains(event.target)
                && (event.target === doc || event.target.contains?.(header))) this.close(false);
        };
        const resize = () => this.close(false);
        doc.addEventListener("pointerdown", outside, true);
        doc.addEventListener("focusin", outside, true);
        doc.addEventListener("scroll", scroll, true);
        doc.defaultView.addEventListener("resize", resize);
        panel.addEventListener("keydown", (event) => this.keydown(event));
        this.cleanup = () => {
            doc.removeEventListener("pointerdown", outside, true);
            doc.removeEventListener("focusin", outside, true);
            doc.removeEventListener("scroll", scroll, true);
            doc.defaultView.removeEventListener("resize", resize);
        };
    }

    position() {
        if (this.parentPanel) { this.positionSubmenu(); return; }
        const rect = this.trigger.getBoundingClientRect();
        const win = this.panel.ownerDocument.defaultView;
        const below = win.innerHeight - rect.bottom - 14;
        const above = rect.top - 14;
        const height = ["settings", "block"].includes(this.panel.dataset.menu)
            ? win.innerHeight - 16 : Math.min(340, Math.max(below, above));
        this.panel.style.maxHeight = `${height}px`;
        const bounds = this.panel.getBoundingClientRect();
        const left = this.panel.dataset.menu === "block" ? rect.right - bounds.width : rect.left;
        this.panel.style.left = `${Math.max(8, Math.min(left, win.innerWidth - bounds.width - 8))}px`;
        const top = below >= bounds.height || below >= above ? rect.bottom + 6 : rect.top - bounds.height - 6;
        this.panel.style.top = `${Math.max(8, Math.min(top, win.innerHeight - bounds.height - 8))}px`;
    }

    row(label, action, icon) {
        const button = this.panel.ownerDocument.createElement("button");
        button.type = "button";
        button.className = "pw-code-menu-row";
        const text = button.ownerDocument.createElement("span");
        text.textContent = label;
        button.append(text);
        if (icon) {
            button.classList.add("pw-code-block-action");
            const leading = button.ownerDocument.createElement("span");
            leading.className = "pw-code-menu-icon";
            leading.setAttribute("aria-hidden", "true");
            this.setIcon(leading, icon);
            button.prepend(leading);
        }
        button.addEventListener("click", action);
        this.panel.append(button);
        return button;
    }

    renderChoices(key, values, submenu) {
        const options = this.binding.getBlock()?.options;
        if (!options) { this.close(false); return; }
        this.panel.replaceChildren();
        const list = this.panel.ownerDocument.createElement("div");
        list.setAttribute("role", "listbox");
        list.setAttribute("aria-label", key);
        this.panel.append(list);
        for (const [value, label] of values) {
            const button = this.row(label, async () => {
                const binding = this.binding;
                const panel = this.panel;
                await binding.update(key, value);
                if (this.panel !== panel) return;
                if (!submenu) { this.close(); return; }
                this.closeSubmenu();
            });
            button.setAttribute("role", "option");
            button.setAttribute("aria-selected", String(options[key] === value));
            list.append(button);
            if (options[key] === value) {
                const icon = button.ownerDocument.createElement("span");
                this.setIcon(icon, "check");
                button.append(icon);
            }
        }
    }

    renderSettings() {
        const options = this.binding.getBlock()?.options;
        if (!options) { this.close(false); return; }
        this.panel.replaceChildren();
        for (const [label, key, values] of [
            ["Font Size", "font", FONT_SIZES.map((size) => [size, `${size}px`])],
            ["Indent Style", "indent", [["spaces", "Spaces"], ["tabs", "Tabs"]]],
            ["Indent Unit", "unit", [2, 4, 8].map((size) => [size, `${size} columns`])],
        ]) {
            if (key === "indent") this.separator();
            const openChoices = (focus = true) => {
                if (this.submenuTrigger !== row) {
                    this.openSubmenu(label, key, row);
                    this.renderChoices(key, values, true);
                }
                this.position();
                if (focus) this.panel.querySelector('[aria-selected="true"], button')?.focus({ preventScroll: true });
                this.panel.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
            };
            const row = this.row(label, () => openChoices());
            if (key === "font") this.bindHoverSubmenu(row, () => openChoices(false));
            this.chevron(row);
            row.setAttribute("aria-haspopup", "dialog");
        }
        this.separator();
        for (const [label, key] of [["Auto Wrap", "wrap"], ["Line Numbers", "lineNumbers"], ["Auto Indent", "autoIndent"]]) {
            if (key === "autoIndent") this.separator();
            const row = this.row(label, async () => {
                this.closeSubmenu(false);
                const binding = this.binding;
                const enabled = !binding.getBlock().options[key];
                await binding.update(key, enabled ? "on" : "off");
                if (this.panel?.contains(row)) row.setAttribute("aria-checked", String(binding.getBlock().options[key]));
            });
            row.setAttribute("role", "switch");
            row.setAttribute("aria-checked", String(options[key]));
            const track = row.ownerDocument.createElement("span");
            track.className = "pw-code-switch";
            track.setAttribute("aria-hidden", "true");
            row.append(track);
        }
    }

    chevron(row) {
        const icon = row.ownerDocument.createElement("span");
        icon.className = "pw-code-menu-chevron";
        icon.setAttribute("aria-hidden", "true");
        this.setIcon(icon, "chevron-right");
        icon.querySelector("svg")?.setAttribute("viewBox", "6 4 12 16");
        row.append(icon);
    }

    renderBlockMenu() {
        this.panel.dataset.menu = "block";
        this.panel.replaceChildren();
        for (const [label, icon, action, submenu, divider] of [
            ["Turn into", "repeat-2", (event) => this.renderTypes("turn-into", event.currentTarget), true],
            ["Delete", "trash-2", () => this.perform("delete"), false, true],
            ["Copy", "copy", () => this.perform("copy")],
            ["Cut", "scissors", () => this.perform("cut")],
            ["Indent", "indent-increase", (event) => this.renderIndent(event.currentTarget), true, true],
            ["Copy link", "link", () => this.perform("copy-link")],
            ["Add below", "plus", (event) => this.renderInsert(event.currentTarget), true, true],
        ]) {
            if (label === "Indent" && this.binding.canIndent === false) continue;
            if (divider) this.separator();
            const row = this.row(label, action, icon);
            if (label === "Turn into") this.bindHoverSubmenu(row, () => this.renderTypes("turn-into", row, false));
            if (label === "Delete") row.classList.add("pw-code-menu-danger");
            if (submenu) { this.chevron(row); row.setAttribute("aria-haspopup", "dialog"); }
        }
    }

    perform(action, value) {
        const binding = this.binding;
        this.close(false);
        binding?.perform?.(action, value);
    }

    bindHoverSubmenu(row, open) {
        row.addEventListener("pointerenter", (event) => {
            if (event.pointerType === "touch") return;
            this.cancelSubmenuClose();
            if (this.submenuTrigger !== row) open();
        });
        row.addEventListener("pointerleave", (event) => {
            if (this.submenuTrigger === row) this.scheduleSubmenuClose(event);
        });
    }

    cancelSubmenuClose() {
        this.submenuTimerWindow?.clearTimeout(this.submenuCloseTimer);
        this.submenuCloseTimer = undefined;
        this.submenuTimerWindow = undefined;
    }

    scheduleSubmenuClose(event) {
        if (event.pointerType === "touch" || !this.parentPanel) return;
        this.cancelSubmenuClose();
        const next = event.relatedTarget;
        if (next?.nodeType && (this.panel.contains(next) || this.submenuTrigger?.contains(next))) return;
        const panel = this.panel;
        this.submenuTimerWindow = panel.ownerDocument.defaultView;
        // Allow crossing the small gap between the trigger and its submenu.
        this.submenuCloseTimer = this.submenuTimerWindow.setTimeout(() => {
            if (this.panel === panel) this.closeSubmenu(false);
        }, 120);
    }

    openSubmenu(label, menu, trigger) {
        this.closeSubmenu(false);
        this.parentPanel = this.panel;
        this.submenuTrigger = trigger ?? this.parentPanel.querySelector("button");
        this.submenuTrigger?.setAttribute("aria-expanded", "true");
        const doc = this.parentPanel.ownerDocument;
        this.panel = doc.createElement("div");
        this.panel.className = "pw-code-popover";
        this.panel.dataset.menu = menu;
        this.panel.setAttribute("role", "dialog");
        this.panel.setAttribute("aria-label", label);
        this.panel.addEventListener("keydown", (event) => this.keydown(event));
        if (menu === "font" || menu === "types" && label === "Turn into") {
            this.panel.classList.add("pw-code-hover-submenu");
            this.panel.addEventListener("pointerenter", () => this.cancelSubmenuClose());
            this.panel.addEventListener("pointerleave", (event) => this.scheduleSubmenuClose(event));
        }
        doc.body.append(this.panel);
    }

    positionSubmenu() {
        const rect = this.submenuTrigger.getBoundingClientRect();
        const parent = this.parentPanel.getBoundingClientRect();
        const win = this.panel.ownerDocument.defaultView;
        const height = ["types", "font"].includes(this.panel.dataset.menu) ? win.innerHeight - 16 : Math.min(420, win.innerHeight - 16);
        this.panel.style.maxHeight = `${height}px`;
        const bounds = this.panel.getBoundingClientRect();
        const left = parent.right + 6 + bounds.width <= win.innerWidth - 8 ? parent.right + 6 : parent.left - bounds.width - 6;
        this.panel.style.left = `${Math.max(8, Math.min(left, win.innerWidth - bounds.width - 8))}px`;
        this.panel.style.top = `${Math.max(8, Math.min(rect.top, win.innerHeight - bounds.height - 8))}px`;
    }

    closeSubmenu(focus = true) {
        this.cancelSubmenuClose();
        if (!this.parentPanel) return;
        this.panel?.remove();
        this.panel = this.parentPanel;
        this.parentPanel = undefined;
        this.submenuTrigger?.setAttribute("aria-expanded", "false");
        if (focus) this.submenuTrigger?.focus({ preventScroll: true });
        this.submenuTrigger = undefined;
    }

    renderTypes(action, trigger, focus = true) {
        this.openSubmenu(action === "turn-into" ? "Turn into" : "Add below", "types", trigger);
        for (const types of [HEADINGS, BASIC_BLOCKS]) {
            const grid = this.panel.ownerDocument.createElement("div");
            grid.className = "pw-code-type-grid";
            grid.setAttribute("role", "group");
            grid.setAttribute("aria-label", types === HEADINGS ? "Headings" : "Basic blocks");
            this.panel.append(grid);
            for (const { id, label, icon } of types) {
                const button = this.panel.ownerDocument.createElement("button");
                button.type = "button";
                button.className = "pw-code-type-button";
                button.setAttribute("aria-label", label);
                this.setIcon(button, icon);
                if (action === "turn-into") button.setAttribute("aria-pressed", String(id === (this.binding.getBlock()?.type ?? "code")));
                button.addEventListener("click", () => this.perform(action, id));
                grid.append(button);
            }
        }
        this.separator();
        for (const { id, label, icon } of RICH_BLOCKS) this.row(label, () => this.perform(action, id), icon);
        this.position();
        if (focus) this.panel.querySelector('[aria-pressed="true"], .pw-code-type-button')?.focus();
    }

    renderInsert(trigger) {
        this.openSubmenu("Add below", "insert", trigger);
        for (const { label, items } of INSERT_GROUPS) {
            const heading = this.panel.ownerDocument.createElement("div");
            heading.className = "pw-code-menu-section";
            heading.textContent = label;
            heading.setAttribute("role", "heading");
            heading.setAttribute("aria-level", "3");
            this.panel.append(heading);
            for (const { id, label: title, icon } of items) this.row(title, () => this.perform("add-below", id), icon);
        }
        this.position();
        this.panel.querySelector("button")?.focus({ preventScroll: true });
    }

    renderIndent(trigger) {
        this.openSubmenu("Indent", "indent", trigger);
        const offset = this.binding.getBlock()?.options.offset ?? 0;
        this.row("Increase indent", () => this.perform("indent", 1), "indent-increase").disabled = offset >= 6;
        this.row("Decrease indent", () => this.perform("indent", -1), "indent-decrease").disabled = offset === 0;
        this.position();
        this.panel.querySelector("button:not(:disabled)")?.focus();
    }

    separator() {
        const separator = this.panel.ownerDocument.createElement("div");
        separator.className = "pw-code-menu-divider";
        separator.setAttribute("role", "separator");
        this.panel.append(separator);
    }

    keydown(event) {
        const panel = event.currentTarget;
        const active = panel.ownerDocument.activeElement;
        const grid = active?.closest(".pw-code-type-grid");
        if (event.key === "Escape" || event.key === "ArrowLeft" && this.parentPanel && !grid) {
            event.preventDefault();
            event.stopPropagation();
            if (this.parentPanel) this.closeSubmenu();
            else this.close();
            return;
        }
        if (event.key === "ArrowRight" && active?.getAttribute("aria-haspopup") === "dialog") {
            event.preventDefault();
            active.click();
            return;
        }
        const actions = { ArrowDown: grid ? 6 : 1, ArrowUp: grid ? -6 : -1, ArrowRight: 1, ArrowLeft: -1, Home: "first", End: "last" };
        if (!(event.key in actions)) return;
        event.preventDefault();
        const buttons = [...panel.querySelectorAll("button:not(:disabled)")];
        const index = buttons.indexOf(active);
        const step = actions[event.key];
        const next = step === "first" ? 0 : step === "last" ? buttons.length - 1 : (index + step + buttons.length) % buttons.length;
        buttons[next]?.focus();
    }

    showCopied(doc) {
        if (this.disposed) return;
        this.clearToast();
        const toast = doc.createElement("div");
        toast.className = "pw-code-copy-toast";
        toast.setAttribute("role", "status");
        const icon = doc.createElement("span");
        icon.className = "pw-code-copy-success";
        this.setIcon(icon, "circle-check");
        toast.append(icon, doc.createTextNode("copied successfully"));
        doc.body.append(toast);
        this.toast = toast;
        this.toastWindow = doc.defaultView;
        this.toastTimer = this.toastWindow.setTimeout(() => this.clearToast(), 1800);
    }

    clearToast() {
        this.toastWindow?.clearTimeout(this.toastTimer);
        this.toast?.remove();
        this.toast = undefined;
        this.toastWindow = undefined;
    }

    closeForHeader(header) { if (this.header === header) this.close(false); }

    close(focus = true) {
        const trigger = this.trigger;
        this.closeSubmenu(false);
        this.cleanup?.();
        this.cleanup = undefined;
        this.panel?.remove();
        if (this.header) delete this.header.dataset.menuOpen;
        this.panel = undefined;
        this.trigger = undefined;
        this.header = undefined;
        this.binding = undefined;
        trigger?.setAttribute("aria-expanded", "false");
        if (focus && trigger?.isConnected) trigger.focus({ preventScroll: true });
    }

    dispose() {
        this.disposed = true;
        this.close(false);
        this.clearToast();
        for (const [doc, observer] of this.tooltipObservers) {
            observer.disconnect();
            for (const tooltip of doc.querySelectorAll(".pw-code-tooltip")) tooltip.classList.remove("pw-code-tooltip");
        }
        this.tooltipObservers.clear();
    }
}

export { NoteCodeMenus };
