import { Notice, setTooltip } from "obsidian";
import { scopeModule } from "../../../utils/module-scope";
import { setIcon } from "../utils/icons";
import { NativeControls } from "../utils/native-controls";

/** Render rail placement from registrations; no knowledge of feature contents. */
export class LeftActions {
    constructor(ribbon, context, toggle, items) {
        this.context = context;
        this.toggle = toggle;
        this.items = items;
        this.native = new NativeControls();
        this.keys = new Map();
        this.main = ribbon.createDiv({ cls: "pw-left-panel-actions" });
        ribbon.prepend(this.main);
        this.tools = ribbon.createDiv({ cls: "pw-bottom-tool-actions" });
        this.shortcuts = ribbon.createDiv({ cls: "pw-left-ribbon-shortcuts", attr: { role: "toolbar", "aria-label": "Workspace shortcuts" } });
        this.main.after(this.shortcuts);
        this.scopes = [scopeModule(this.main, "borders", { border: "left" }), scopeModule(this.tools, "borders", { border: "left" })];
        this.buttons = new Map();
        this.scopes.push(scopeModule(this.shortcuts, "borders", { border: "left" }));
    }

    sync(definitions, states) {
        for (const [id, icon] of [["switcher:Open quick switcher", "file-search"], ["command-palette:Open command palette", "command-palette"]]) {
            const button = this.items().find(item => item.id === id)?.buttonEl;
            if (!button || button.ownerDocument !== this.context.document) continue;
            this.native.move(button, this.shortcuts, { role: "button", tabindex: "0", "data-tooltip-position": "right" }, target => setIcon(target, icon));
            if (!this.keys.has(button) && button.tagName !== "BUTTON") {
                const key = event => { if (["Enter", " "].includes(event.key)) { event.preventDefault(); button.click(); } };
                button.addEventListener("keydown", key); this.keys.set(button, key);
            }
        }
        const ids = new Set(definitions.map(definition => definition.id));
        const positions = new Map();
        for (const [id, button] of this.buttons) if (!ids.has(id)) { button.remove(); this.buttons.delete(id); }
        for (const definition of definitions.sort((a, b) => a.order - b.order)) {
            let button = this.buttons.get(definition.id);
            if (!button) {
                button = this.main.ownerDocument.createElement("button");
                button.type = "button";
                button.className = `clickable-icon${definition.id === "project" ? " pw-left-sidebar-toggle" : definition.id === "git:commit" ? " pw-git-ribbon-action" : ""}`;
                button.setAttribute("aria-label", definition.label); button.setAttribute("data-tooltip-position", "right");
                setTooltip(button, definition.label, { placement: "right", delay: 0 });
                setIcon(button, definition.icon);
                button.addEventListener("click", () => {
                    void this.toggle(definition.id, { context: this.context, focus: true }).catch(error => new Notice(error.message));
                });
                this.buttons.set(definition.id, button);
            }
            const state = states.get(definition.id);
            button.setAttribute("aria-pressed", String(state?.visible ?? false));
            button.setAttribute("aria-expanded", String(state?.visible ?? false));
            button.setAttribute("data-pw-panel-focused", String(state?.focused ?? false));
            const host = definition.railGroup === "tools" ? this.tools : this.main;
            const index = positions.get(host) ?? 0;
            if (host.children[index] !== button) host.insertBefore(button, host.children[index] ?? null);
            positions.set(host, index + 1);
        }
    }

    dispose() {
        for (const [button, key] of this.keys) button.removeEventListener("keydown", key);
        this.keys.clear(); this.native.dispose();
        for (const scope of this.scopes) scope.dispose();
        this.main.remove(); this.tools.remove(); this.shortcuts.remove(); this.buttons.clear();
    }
}
