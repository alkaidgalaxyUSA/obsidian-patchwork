import { Notice, setTooltip } from "obsidian";
import { scopeModule } from "../../../utils/module-scope";
import { setIcon } from "../utils/icons";
import { SidebarHandle } from "./sidebar-handle";

export class RightActions {
    constructor(ribbon, adapter, context, toggle) {
        this.context = context; this.toggle = toggle;
        this.toolbar = ribbon.createDiv({ cls: "pw-window-actions", attr: { role: "toolbar", "aria-label": "Right sidebar shortcuts" } });
        this.scope = scopeModule(this.toolbar, "borders", { border: "right" });
        this.handle = new SidebarHandle(adapter, context, toggle);
        this.buttons = new Map();
    }

    sync(definitions, states, active) {
        const ids = new Set(definitions.map(definition => definition.id));
        for (const [id, button] of this.buttons) if (!ids.has(id)) { button.remove(); this.buttons.delete(id); }
        for (const [index, definition] of definitions.sort((a, b) => a.order - b.order).entries()) {
            let button = this.buttons.get(definition.id);
            if (!button) {
                button = this.toolbar.createEl("button", { cls: "clickable-icon side-dock-ribbon-action", attr: { type: "button", "aria-label": definition.label, "data-tooltip-position": "left" } });
                setIcon(button, definition.icon);
                setTooltip(button, definition.label, { placement: "left", delay: 0 });
                button.addEventListener("click", () => {
                    void this.toggle(definition.id, { context: this.context, focus: true }).catch(error => new Notice(error.message));
                });
                this.buttons.set(definition.id, button);
            }
            const state = states.get(definition.id);
            button.setAttribute("aria-pressed", String(state?.visible ?? false));
            button.setAttribute("data-pw-panel-focused", String(state?.focused ?? false));
            if (this.toolbar.children[index] !== button) this.toolbar.insertBefore(button, this.toolbar.children[index] ?? null);
        }
        this.handle.sync(active);
    }

    dispose() { this.handle.dispose(); this.scope.dispose(); this.toolbar.remove(); this.buttons.clear(); }
}
