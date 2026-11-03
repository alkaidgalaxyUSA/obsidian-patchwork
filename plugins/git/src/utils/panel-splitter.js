/** Keyboard and pointer resizing with a persisted pixel size. */
export class PanelSplitter {
    constructor(container, handle, target, axis, initial, saved, reverse = false) {
        Object.assign(this, { container, handle, target, axis, saved, reverse });
        handle.classList.add("pw-git-panel-splitter", axis === "x" ? "is-vertical" : "is-horizontal");
        handle.tabIndex = 0;
        handle.setAttribute("role", "separator");
        handle.setAttribute("aria-label", "Resize Git panel");
        handle.setAttribute("aria-orientation", axis === "x" ? "vertical" : "horizontal");
        this.listeners = {
            pointerdown: event => {
                if (event.button !== 0) return;
                event.preventDefault(); this.pointer = event.pointerId;
                this.start = axis === "x" ? event.clientX : event.clientY;
                this.before = target.getBoundingClientRect()[axis === "x" ? "width" : "height"];
                handle.setPointerCapture(event.pointerId); container.classList.add("is-resizing");
            },
            pointermove: event => {
                if (event.pointerId !== this.pointer) return;
                this.setSize(this.before + ((axis === "x" ? event.clientX : event.clientY) - this.start) * (reverse ? -1 : 1));
            },
            pointerup: () => this.stop(true), pointercancel: () => this.stop(false), lostpointercapture: () => this.stop(false),
            keydown: event => {
                const direction = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[event.key];
                if (!direction) return;
                event.preventDefault(); this.setSize(this.size + direction * 16 * (reverse ? -1 : 1)); saved(this.size);
            },
        };
        for (const [event, handler] of Object.entries(this.listeners)) handle.addEventListener(event, handler);
        this.setSize(initial);
    }
    setSize(size) {
        const available = this.container.getBoundingClientRect()[this.axis === "x" ? "width" : "height"];
        this.size = Math.max(this.axis === "x" ? 120 : 70, Math.min(Number(size) || 200, available > 0 ? available * .6 : 480));
        this.target.style.flexBasis = `${this.size}px`;
        this.handle.setAttribute("aria-valuenow", String(Math.round(this.size)));
    }
    stop(persist) {
        if (this.pointer === undefined) return;
        const pointer = this.pointer; this.pointer = undefined;
        if (this.handle.hasPointerCapture(pointer)) this.handle.releasePointerCapture(pointer);
        this.container.classList.remove("is-resizing");
        if (persist) this.saved(this.size);
    }
    dispose() { this.stop(false); for (const [event, handler] of Object.entries(this.listeners)) this.handle.removeEventListener(event, handler); }
}
