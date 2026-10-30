import { setIcon } from "../../../../utils/icons";
import { TerminalTool } from "./terminal-tool";
import { GitTool } from "./git-tool";

export class BottomTools {
    constructor(plugin) {
        this.plugin = plugin;
        this.workspace = plugin.app.workspace.containerEl;
        this.height = 350;
        this.tools = new Map();
        this.buttons = new Map();
        const ribbon = plugin.app.workspace.leftRibbon.containerEl;
        this.actions = ribbon.createDiv({ cls: "pw-bottom-tool-actions", attr: { role: "toolbar", "aria-label": "Tool windows" } });
        this.el = this.workspace.createDiv({ cls: "pw-bottom-tools" });
        this.el.hidden = true;
        this.grip = this.el.createDiv({ cls: "pw-bottom-tool-resize", attr: { role: "separator", tabindex: "0", "aria-label": "Tool window height", "aria-orientation": "horizontal" } });
        this.grip.addEventListener("pointerdown", event => {
            if (event.button !== 0) return;
            event.preventDefault();
            this.drag = { y: event.clientY, height: this.height };
            this.grip.setPointerCapture(event.pointerId);
        });
        this.grip.addEventListener("pointermove", event => {
            if (!this.drag) return;
            this.height = this.drag.height + this.drag.y - event.clientY;
            this.layout();
        });
        this.grip.addEventListener("lostpointercapture", () => { this.drag = undefined; });
        this.grip.addEventListener("keydown", event => {
            if (!["ArrowUp", "ArrowDown"].includes(event.key)) return;
            event.preventDefault(); this.height += event.key === "ArrowUp" ? 10 : -10; this.layout();
        });
        for (const [id, title, icon] of [["terminal", "Terminal", "terminal"], ["git", "Git", "git-branch"]]) {
            const button = this.actions.createEl("button", { cls: "clickable-icon", attr: { type: "button", "aria-label": title, "aria-pressed": "false", "data-tooltip-position": "right" } });
            setIcon(button, icon);
            button.addEventListener("click", () => this.active === id ? this.hide() : this.show(id));
            this.buttons.set(id, button);
        }
        this.observer = new this.workspace.ownerDocument.defaultView.ResizeObserver(() => this.layout());
        this.observer.observe(this.workspace);
    }

    show(id) {
        this.active = id;
        this.el.hidden = false;
        this.workspace.classList.add("pw-tools-open");
        this.layout();
        if (!this.tools.has(id)) {
            const host = this.el.createDiv({ cls: "pw-tool-window" });
            const tool = id === "terminal" ? new TerminalTool(this.plugin, host, () => this.hide()) : new GitTool(this.plugin, host, () => this.hide());
            this.tools.set(id, { host, tool });
        }
        for (const [key, entry] of this.tools) entry.host.hidden = key !== id;
        for (const [key, button] of this.buttons) button.setAttribute("aria-pressed", String(key === id));
        this.tools.get(id).tool.show();
    }

    hide() {
        this.active = undefined;
        this.el.hidden = true;
        this.workspace.classList.remove("pw-tools-open");
        for (const button of this.buttons.values()) button.setAttribute("aria-pressed", "false");
    }

    layout() {
        this.height = Math.max(140, Math.min(this.height, this.workspace.clientHeight - 160));
        this.workspace.style.setProperty("--pw-tool-height", `${this.height}px`);
        this.grip.setAttribute("aria-valuenow", String(this.height));
        const left = this.plugin.app.workspace.leftRibbon.containerEl.getBoundingClientRect().width;
        const right = this.plugin.app.workspace.rightRibbon.containerEl.getBoundingClientRect().width;
        this.el.style.left = `${left}px`; this.el.style.right = `${right}px`;
    }

    dispose() {
        this.hide(); this.observer.disconnect();
        for (const { tool } of this.tools.values()) tool.dispose();
        this.tools.clear(); this.el.remove(); this.actions.remove();
        this.workspace.style.removeProperty("--pw-tool-height");
    }
}

export function installBottomTools(plugin) {
    let disposed = false;
    plugin.app.workspace.onLayoutReady(() => {
        if (!disposed) plugin.bottomTools = new BottomTools(plugin);
    });
    plugin.register(() => { disposed = true; plugin.bottomTools?.dispose(); delete plugin.bottomTools; });
}
