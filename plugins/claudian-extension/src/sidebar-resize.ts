import type { App, Workspace } from "obsidian";
import type { SidebarDock } from "./types";

/** Keep both chat and document layout stable until the sidebar divider is released. */
export class SidebarResize {
    private readonly doc: Document;
    private cancel?: () => void;

    constructor(private readonly app: App) {
        this.doc = app.workspace.containerEl.ownerDocument;
        this.doc.addEventListener("pointerdown", this.start, true);
    }

    private start = (event: PointerEvent) => {
        const dock = this.app.workspace.rightSplit as SidebarDock;
        const handle = dock?.resizeHandleEl;
        const win = this.doc.defaultView;
        if (event.button !== 0 || !event.isPrimary || !win || !handle
            || event.target !== handle || dock.collapsed || typeof dock.setSize !== "function") return;
        const claudian = dock.containerEl.querySelector<HTMLElement>('.workspace-leaf-content[data-type="claudian-view"]');
        if (!claudian?.getClientRects().length) return;

        this.cancel?.();
        // Intercept before Obsidian installs its live-resize listeners.
        event.preventDefault();
        event.stopImmediatePropagation();
        const bounds = dock.containerEl.getBoundingClientRect();
        const workspace = this.app.workspace.containerEl.getBoundingClientRect();
        const style = win.getComputedStyle(dock.containerEl);
        const cssMaximum = Number.parseFloat(style.maxWidth);
        const minimum = Math.max(200, Number.parseFloat(style.minWidth) || 0);
        const maximum = Math.max(minimum, Math.min(workspace.width * 0.8,
            Number.isFinite(cssMaximum) ? cssMaximum : Infinity));
        const startX = event.clientX;
        const pointerId = event.pointerId;
        let width = bounds.width;
        let collapse = false;
        let moved = false;
        let frame = 0;
        let finished = false;
        const listeners = new AbortController();
        const options = { capture: true, signal: listeners.signal };
        const overlay = this.doc.createElement("div");
        overlay.className = "claudian-extension-resize-preview";
        overlay.setAttribute("aria-hidden", "true");
        const line = this.doc.createElement("div");
        line.className = "claudian-extension-resize-line";
        line.style.top = `${workspace.top}px`;
        line.style.height = `${workspace.height}px`;
        overlay.append(line);
        this.doc.body.append(overlay);
        this.doc.body.classList.add("claudian-extension-resizing");
        const draw = () => {
            frame = 0;
            line.style.transform = `translateX(${bounds.right - (collapse ? 0 : width)}px)`;
        };
        draw();
        const update = (x: number) => {
            if (Math.abs(x - startX) > 2) moved = true;
            const requested = bounds.width + startX - x;
            collapse = requested < 50;
            width = Math.min(maximum, Math.max(minimum, requested));
        };
        const finish = (commit: boolean) => {
            if (finished) return;
            finished = true;
            listeners.abort();
            if (frame) win.cancelAnimationFrame(frame);
            try {
                if (commit && moved && !dock.collapsed && dock.containerEl.isConnected) {
                    if (collapse) dock.collapse();
                    else dock.setSize?.(width);
                    // Resolve the single final layout while width transitions are disabled.
                    dock.containerEl.getBoundingClientRect();
                    this.app.workspace.requestSaveLayout();
                    (this.app.workspace as Workspace & { requestResize?: () => void }).requestResize?.();
                }
            } finally {
                if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
                overlay.remove();
                this.doc.body.classList.remove("claudian-extension-resizing");
                this.cancel = undefined;
            }
        };
        this.cancel = () => finish(false);
        win.addEventListener("pointermove", (move) => {
            if (move.pointerId !== pointerId) return;
            move.preventDefault();
            move.stopImmediatePropagation();
            if (!move.buttons) { finish(false); return; }
            update(move.clientX);
            if (!frame) frame = win.requestAnimationFrame(draw);
        }, options);
        win.addEventListener("pointerup", (up) => {
            if (up.pointerId !== pointerId) return;
            up.preventDefault();
            up.stopImmediatePropagation();
            update(up.clientX);
            finish(true);
        }, options);
        win.addEventListener("pointercancel", (cancel) => {
            if (cancel.pointerId === pointerId) finish(false);
        }, options);
        handle.addEventListener("lostpointercapture", () => finish(false), options);
        win.addEventListener("blur", () => finish(false), options);
        win.addEventListener("resize", () => finish(false), options);
        win.addEventListener("keydown", (key) => {
            if (key.key !== "Escape") return;
            key.preventDefault();
            key.stopImmediatePropagation();
            finish(false);
        }, options);
        this.doc.addEventListener("visibilitychange", () => {
            if (this.doc.hidden) finish(false);
        }, options);
        // Capture also keeps the gesture reliable when the pointer leaves the divider.
        try { handle.setPointerCapture(pointerId); } catch { /* Synthetic input has no active pointer. */ }
    };

    dispose() {
        this.cancel?.();
        this.doc.removeEventListener("pointerdown", this.start, true);
    }
}
