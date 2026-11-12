/** Pointer leases and viewport-bounded geometry for the background-task popup. */
export class ProgressPopupGeometry {
    constructor(view, header) {
        this.view = view; this.popup = view.popup; this.win = view.doc.defaultView;
        this.listeners = []; this.handles = [];
        this.bind(header, "move");
        for (const edge of ["n", "e", "s", "w", "ne", "se", "sw", "nw"]) {
            const handle = view.doc.createElement("button");
            handle.className = "pw-progress-resize"; handle.dataset.edge = edge;
            handle.type = "button"; handle.tabIndex = edge === "se" ? 0 : -1;
            handle.setAttribute("aria-label", `Resize background tasks (${edge})`);
            this.popup.append(handle); this.handles.push(handle); this.bind(handle, edge);
            this.listen(handle, "keydown", event => {
                if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
                event.preventDefault(); event.stopPropagation();
                const rect = this.popup.getBoundingClientRect(), step = event.shiftKey ? 4 : 16;
                this.apply({ left: rect.left, top: rect.top,
                    width: rect.width + (event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0),
                    height: rect.height + (event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0) });
            });
        }
    }

    listen(element, name, handler) {
        element.addEventListener(name, handler);
        this.listeners.push(() => element.removeEventListener(name, handler));
    }

    bind(element, edge) {
        this.listen(element, "pointerdown", event => {
            if (event.button !== 0 || edge === "move" && event.target.closest("button")) return;
            event.preventDefault(); event.stopPropagation(); this.stop();
            this.drag = { element, edge, id: event.pointerId, x: event.clientX, y: event.clientY, rect: this.popup.getBoundingClientRect() };
            element.setPointerCapture(event.pointerId);
        });
        this.listen(element, "pointermove", event => {
            if (this.drag?.id !== event.pointerId) return;
            this.next = { x: event.clientX, y: event.clientY };
            if (this.frame === undefined) this.frame = this.win.requestAnimationFrame(() => { this.frame = undefined; this.flush(); });
        });
        this.listen(element, "pointerup", event => {
            if (this.drag?.id !== event.pointerId) return;
            this.next = { x: event.clientX, y: event.clientY }; this.flush(); this.stop();
        });
        for (const name of ["pointercancel", "lostpointercapture"]) this.listen(element, name, () => this.stop());
    }

    flush() {
        if (!this.drag || !this.next) return;
        const { edge, rect, x, y } = this.drag, dx = this.next.x - x, dy = this.next.y - y;
        this.next = undefined;
        if (edge === "move") {
            this.apply({ left: rect.left + dx, top: rect.top + dy, width: rect.width, height: rect.height });
            return;
        }
        const minWidth = Math.min(240, this.win.innerWidth - 16), minHeight = Math.min(120, this.win.innerHeight - 16);
        const left = edge.includes("w") ? Math.max(8, Math.min(rect.left + dx, rect.right - minWidth)) : rect.left;
        const top = edge.includes("n") ? Math.max(8, Math.min(rect.top + dy, rect.bottom - minHeight)) : rect.top;
        const right = edge.includes("e") ? Math.min(this.win.innerWidth - 8, Math.max(rect.right + dx, left + minWidth)) : rect.right;
        const bottom = edge.includes("s") ? Math.min(this.win.innerHeight - 8, Math.max(rect.bottom + dy, top + minHeight)) : rect.bottom;
        this.apply({ left, top, width: right - left, height: bottom - top });
    }

    apply(bounds) {
        const width = Math.min(Math.max(240, bounds.width), Math.max(1, this.win.innerWidth - 16));
        const height = Math.min(Math.max(120, bounds.height), Math.max(1, this.win.innerHeight - 16));
        const left = Math.max(8, Math.min(bounds.left, this.win.innerWidth - width - 8));
        const top = Math.max(8, Math.min(bounds.top, this.win.innerHeight - height - 8));
        this.view.popupBounds = { left, top, width, height };
        this.popup.dataset.userSized = "true";
        const styles = { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px`, bottom: "auto", maxHeight: `${Math.max(1, this.win.innerHeight - 16)}px` };
        for (const [key, value] of Object.entries(styles)) if (this.popup.style[key] !== value) this.popup.style[key] = value;
    }

    stop() {
        if (this.frame !== undefined) this.win.cancelAnimationFrame(this.frame);
        this.frame = undefined; this.next = undefined;
        const drag = this.drag; this.drag = undefined;
        if (drag?.element.hasPointerCapture(drag.id)) drag.element.releasePointerCapture(drag.id);
    }

    dispose() {
        this.stop();
        for (const remove of this.listeners) remove();
        for (const handle of this.handles) handle.remove();
        this.listeners = []; this.handles = [];
    }
}
