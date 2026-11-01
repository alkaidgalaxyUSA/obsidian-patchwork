import { Notice } from "obsidian";
import { scopeModule } from "../../../utils/module-scope";
import { setIcon } from "../utils/icons";

export class SidebarHandle {
    constructor(adapter, context, toggle) { this.adapter = adapter; this.context = context; this.toggle = toggle; }

    sync(definition) {
        if (!definition) { this.remove(); return; }
        const dock = this.adapter.dock("right", this.context);
        if (!this.adapter.leaves(definition, this.context).length) { this.remove(); return; }
        if (!this.edge) {
            const doc = this.context.document;
            this.edge = doc.createElement("div"); this.edge.className = "pw-sidebar-edge";
            this.scope = scopeModule(this.edge, "borders", { border: "right" });
            this.button = this.edge.createEl("button", { cls: "pw-sidebar-collapse", attr: { type: "button" } });
            this.button.addEventListener("pointerdown", event => event.stopPropagation());
            this.button.addEventListener("click", event => {
                event.preventDefault(); event.stopPropagation();
                void this.toggle(this.definition.id, { context: this.context, focus: true }).catch(error => new Notice(error.message));
            });
            doc.body.append(this.edge);
        }
        this.definition = definition;
        const mode = dock.collapsed ? "expand" : "collapse";
        if (this.edge.dataset.mode !== mode) {
            this.edge.dataset.mode = mode;
            this.button.setAttribute("aria-label", dock.collapsed ? "Expand right sidebar" : "Collapse right sidebar");
            this.button.setAttribute("aria-expanded", String(!dock.collapsed));
            setIcon(this.button, dock.collapsed ? "chevron-left" : "chevron-right");
        }
        const workspace = this.adapter.window(this.context).containerEl.getBoundingClientRect();
        this.edge.style.top = `${workspace.top}px`; this.edge.style.height = `${workspace.height}px`;
        const bounds = dock.collapsed ? workspace : dock.containerEl.getBoundingClientRect();
        this.button.style.left = dock.collapsed ? "" : `${Math.max(0, bounds.left - 5.04)}px`;
        this.button.style.right = dock.collapsed ? "0px" : "";
        this.button.style.top = `${bounds.top + bounds.height / 2}px`;
    }

    remove() { this.scope?.dispose(); this.edge?.remove(); this.edge = undefined; this.button = undefined; }
    dispose() { this.remove(); }
}
