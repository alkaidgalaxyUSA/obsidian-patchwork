import { Notice } from "obsidian";

/** Owns the branch popup's pointer capture, saved dimensions and resize handle. */
export class GitPopupResize {
    constructor(popup) {
        this.popup = popup;
        this.win = popup.doc.defaultView;
        this.store = popup.controller.plugin.settingsStore;
        const saved = this.store.preferences.branchPopupSize;
        if (Number.isFinite(saved?.width) && Number.isFinite(saved?.height) && saved.width > 0 && saved.height > 0) this.apply(saved);
        this.handle = popup.el.createEl("button", { cls: "pw-git-popup-resize", attr: { type: "button", "aria-label": "Resize branch popup", title: "Drag to resize. Arrow keys resize; Home restores the default size." } });
        this.handle.onpointerdown = event => {
            if (event.button !== 0) return;
            event.preventDefault(); event.stopPropagation();
            popup.branchMenu?.hide(); popup.settingsMenu?.hide();
            this.drag = { id: event.pointerId, x: event.clientX, y: event.clientY, bounds: popup.el.getBoundingClientRect() };
            this.handle.setPointerCapture(event.pointerId);
        };
        this.handle.onpointermove = event => {
            if (this.drag?.id !== event.pointerId) return;
            const { x, y, bounds } = this.drag;
            this.next = { width: bounds.width + event.clientX - x, height: bounds.height + event.clientY - y };
            if (!this.frame) this.frame = this.win.requestAnimationFrame(() => { this.frame = undefined; this.flush(); });
        };
        this.handle.onpointerup = event => {
            if (this.drag?.id !== event.pointerId) return;
            this.flush(); this.stopDrag(); this.save(); popup.position();
        };
        this.handle.onpointercancel = this.handle.onlostpointercapture = () => { if (this.drag) { this.flush(); this.stopDrag(); this.save(); } };
        this.handle.onkeydown = event => {
            if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home"].includes(event.key)) return;
            event.preventDefault(); event.stopPropagation();
            if (event.key === "Home") { this.restore(); return; }
            const bounds = popup.el.getBoundingClientRect(), step = event.shiftKey ? 5 : 20;
            this.apply({ width: bounds.width + (event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0), height: bounds.height + (event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0) });
            popup.position(); this.save();
        };
    }
    apply(size) {
        const bounds = this.drag?.bounds;
        this.size = {
            width: Math.min(Math.max(375, size.width), Math.max(1, this.win.innerWidth - (bounds?.left ?? 8) - 8)),
            height: Math.min(Math.max(320, size.height), Math.max(1, this.win.innerHeight - (bounds?.top ?? 8) - 8)),
        };
        this.popup.el.classList.add("is-user-sized");
        this.popup.el.style.width = `${this.size.width}px`;
        this.popup.el.style.height = `${this.size.height}px`;
    }
    flush() { if (this.next) { this.apply(this.next); this.next = undefined; } }
    save() {
        if (this.popup.controller.disposed) return;
        void this.store.savePreferences({ branchPopupSize: this.size ?? null }).catch(() => new Notice("Could not save Git popup dimensions."));
    }
    restore() {
        this.stopDrag(); this.next = undefined; this.size = undefined;
        this.popup.el.classList.remove("is-user-sized");
        this.popup.el.style.removeProperty("width"); this.popup.el.style.removeProperty("height");
        this.popup.position(); this.save();
    }
    stopDrag() {
        if (this.frame) this.win.cancelAnimationFrame(this.frame);
        this.frame = undefined;
        const id = this.drag?.id; this.drag = undefined;
        if (id !== undefined && this.handle.hasPointerCapture(id)) this.handle.releasePointerCapture(id);
    }
    dispose() { this.stopDrag(); this.next = undefined; this.handle.remove(); }
}
