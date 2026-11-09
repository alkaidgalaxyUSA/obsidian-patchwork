import { scopeModule } from "../../../utils/module-scope";
import { setIcon } from "../utils/icons";
import { ProgressTaskRow } from "./progress-task-row";
import { ProgressPopupGeometry } from "./progress-popup-geometry";

/** Per-window footer and non-modal task list; never executes business work. */
export class BackgroundProgressView {
    constructor(bar, context, progress) {
        this.context = context; this.doc = context.document; this.progress = progress;
        this.tasks = []; this.rows = new Map(); this.disposed = false;
        this.el = this.doc.createElement("div");
        this.el.className = "status-bar-item pw-progress-widget"; this.el.hidden = true;
        this.scope = scopeModule(this.el, "borders", { surface: "background-progress" });
        this.summary = new ProgressTaskRow(this.doc, { compact: true,
            onCancel: id => progress.cancel(id), onOpen: () => this.togglePopup() });
        this.el.append(this.summary.el); bar.append(this.el);
        this.unsubscribe = progress.subscribe(context, tasks => {
            this.tasks = tasks;
            this.schedule();
        });
    }

    schedule() {
        if (this.disposed || this.frame !== undefined) return;
        this.frame = this.doc.defaultView.requestAnimationFrame(() => {
            this.frame = undefined;
            if (!this.disposed) this.render();
        });
    }

    render() {
        const visible = this.tasks.filter(task => task.visible);
        if (this.el.hidden !== !visible.length) this.el.hidden = !visible.length;
        if (!visible.length) { this.closePopup(); return; }
        this.summary.update(visible[0], visible.length);
        if (!this.popup) return;
        const active = new Set(visible.map(task => task.id));
        for (const [id, row] of this.rows) if (!active.has(id)) {
            const hadFocus = row.el.contains(this.doc.activeElement);
            row.dispose(); this.rows.delete(id);
            if (hadFocus) this.closeButton.focus({ preventScroll: true });
        }
        for (const task of visible) {
            let row = this.rows.get(task.id);
            if (!row) {
                row = new ProgressTaskRow(this.doc, { onCancel: id => this.progress.cancel(id) });
                this.rows.set(task.id, row); this.list.append(row.el);
            }
            row.update(task);
        }
        const title = `Background Tasks (${visible.length})`;
        if (this.heading.textContent !== title) this.heading.textContent = title;
        this.positionPopup();
    }

    togglePopup() {
        if (this.popup) { this.closePopup(true); return; }
        if (this.disposed || this.el.hidden || !this.el.isConnected) return;
        this.popup = this.doc.createElement("section"); this.popup.className = "pw-progress-popup";
        this.popup.setAttribute("role", "dialog"); this.popup.setAttribute("aria-label", "Background Tasks");
        this.popupScope = scopeModule(this.popup, "borders", { surface: "background-tasks" });
        this.popupScope.refreshTokens(this.el);
        const header = this.doc.createElement("div"); header.className = "pw-progress-popup-header";
        this.heading = this.doc.createElement("span");
        this.closeButton = this.doc.createElement("button"); this.closeButton.className = "pw-progress-close";
        this.closeButton.type = "button"; this.closeButton.setAttribute("aria-label", "Minimize background tasks");
        this.closeButton.title = "Minimize background tasks";
        setIcon(this.closeButton, "minus"); this.closeButton.addEventListener("click", () => this.closePopup(true));
        header.append(this.heading, this.closeButton);
        this.list = this.doc.createElement("div"); this.list.className = "pw-progress-list";
        this.popup.append(header, this.list); this.doc.body.append(this.popup);
        this.geometry = new ProgressPopupGeometry(this, header);
        this.summary.content.setAttribute("aria-expanded", "true");
        const outside = event => {
            if (!this.popup?.contains(event.target) && !this.el.contains(event.target)) this.closePopup();
        };
        const keydown = event => {
            if (event.key !== "Escape") return;
            event.preventDefault(); event.stopPropagation(); this.closePopup(true);
        };
        const resize = () => this.positionPopup();
        this.doc.addEventListener("pointerdown", outside, true);
        this.doc.addEventListener("focusin", outside);
        this.doc.addEventListener("keydown", keydown, true);
        this.doc.defaultView.addEventListener("resize", resize);
        this.popupCleanup = () => {
            this.doc.removeEventListener("pointerdown", outside, true);
            this.doc.removeEventListener("focusin", outside);
            this.doc.removeEventListener("keydown", keydown, true);
            this.doc.defaultView?.removeEventListener("resize", resize);
        };
        this.render();
        this.closeButton.focus({ preventScroll: true });
    }

    positionPopup() {
        if (!this.popup || !this.el.isConnected) return;
        if (this.popupBounds) { this.geometry.apply(this.popupBounds); return; }
        const anchor = this.el.getBoundingClientRect();
        const win = this.doc.defaultView;
        const left = Math.max(8, Math.min(anchor.right - this.popup.offsetWidth, win.innerWidth - this.popup.offsetWidth - 8));
        const bottom = Math.max(8, win.innerHeight - anchor.top + 6);
        const position = { left: `${left}px`, bottom: `${bottom}px`, maxHeight: `${Math.max(60, anchor.top - 14)}px` };
        for (const [name, value] of Object.entries(position)) if (this.popup.style[name] !== value) this.popup.style[name] = value;
    }

    closePopup(restoreFocus = false) {
        if (!this.popup) return;
        const hadFocus = this.popup.contains(this.doc.activeElement);
        this.geometry?.dispose(); this.geometry = undefined;
        this.popupCleanup?.(); this.popupCleanup = undefined;
        for (const row of this.rows.values()) row.dispose();
        this.rows.clear(); this.popupScope?.dispose(); this.popupScope = undefined;
        this.popup.remove(); this.popup = undefined;
        this.heading = undefined; this.closeButton = undefined; this.list = undefined;
        this.summary.content.setAttribute("aria-expanded", "false");
        if ((restoreFocus || hadFocus) && !this.disposed && !this.el.hidden) this.summary.content.focus({ preventScroll: true });
    }

    dispose() {
        this.disposed = true; this.unsubscribe();
        if (this.frame !== undefined) this.doc.defaultView?.cancelAnimationFrame(this.frame);
        this.closePopup(); this.summary.dispose(); this.scope.dispose(); this.el.remove();
    }
}
