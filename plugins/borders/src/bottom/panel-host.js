import { scopeModule } from "../../../utils/module-scope";

/** Geometry only; feature instances are constructed exclusively by registrations. */
export class PanelHost {
    constructor(workspace, resized) {
        this.workspace = workspace;
        this.height = 350;
        this.previousHeight = workspace.style.getPropertyValue("--pw-tool-height");
        this.previousPriority = workspace.style.getPropertyPriority("--pw-tool-height");
        this.el = workspace.createDiv({ cls: "pw-bottom-tools" });
        this.scope = scopeModule(this.el, "borders", { border: "bottom" });
        this.el.hidden = true;
        this.grip = this.el.createDiv({ cls: "pw-bottom-tool-resize", attr: { role: "separator", tabindex: "0", "aria-label": "Tool window height", "aria-orientation": "horizontal" } });
        this.grip.addEventListener("pointerdown", event => {
            if (event.button !== 0) return;
            event.preventDefault(); this.drag = { y: event.clientY, height: this.height };
            this.grip.setPointerCapture(event.pointerId);
        });
        this.grip.addEventListener("pointermove", event => {
            if (!this.drag) return;
            this.height = this.drag.height + this.drag.y - event.clientY; this.layout();
        });
        this.grip.addEventListener("lostpointercapture", () => { this.drag = undefined; });
        this.grip.addEventListener("keydown", event => {
            if (!["ArrowUp", "ArrowDown"].includes(event.key)) return;
            event.preventDefault(); this.height += event.key === "ArrowUp" ? 10 : -10; this.layout();
        });
        this.resized = resized;
        this.observer = new workspace.ownerDocument.defaultView.ResizeObserver(() => this.layout());
        this.observer.observe(workspace);
    }

    create(owner) {
        const host = this.el.createDiv({ cls: "pw-tool-window" });
        host.hidden = true;
        const scope = scopeModule(host, owner);
        return { host, dispose() { scope.dispose(); host.remove(); } };
    }

    show(host) {
        for (const child of this.el.children) if (child !== this.grip) child.hidden = child !== host;
        this.el.hidden = false; this.workspace.classList.add("pw-tools-open"); this.layout();
    }

    hide() { this.el.hidden = true; this.workspace.classList.remove("pw-tools-open"); }

    layout() {
        if (this.disposed) return;
        this.height = Math.max(140, Math.min(this.height, this.workspace.clientHeight - 160));
        this.workspace.style.setProperty("--pw-tool-height", `${this.height}px`);
        this.grip.setAttribute("aria-valuenow", String(this.height));
        const doc = this.workspace.ownerDocument;
        this.el.style.left = `${doc.querySelector(".workspace-ribbon.mod-primary")?.getBoundingClientRect().width ?? 0}px`;
        this.el.style.right = `${doc.querySelector(".workspace-ribbon.mod-secondary")?.getBoundingClientRect().width ?? 0}px`;
        this.resized();
    }

    dispose() {
        this.disposed = true; this.hide(); this.observer.disconnect(); this.scope.dispose(); this.el.remove();
        if (this.previousHeight) this.workspace.style.setProperty("--pw-tool-height", this.previousHeight, this.previousPriority);
        else this.workspace.style.removeProperty("--pw-tool-height");
    }
}
