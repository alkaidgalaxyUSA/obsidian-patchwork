/** Resize the file list and message editor without rebuilding either surface. */
export class CommitSplitter {
    constructor(body, handle) {
        this.body = body;
        this.handle = handle;
        this.ratio = 0.5;
        handle.tabIndex = 0;
        handle.setAttribute("role", "separator");
        handle.setAttribute("aria-label", "Resize commit message editor");
        handle.setAttribute("aria-orientation", "horizontal");
        handle.setAttribute("aria-valuemin", "20");
        handle.setAttribute("aria-valuemax", "80");
        this.listeners = {
            pointerdown: event => this.start(event),
            pointermove: event => this.move(event),
            pointerup: () => this.stop(),
            pointercancel: () => this.stop(),
            lostpointercapture: () => this.stop(),
            keydown: event => this.keydown(event),
        };
        for (const [name, listener] of Object.entries(this.listeners)) handle.addEventListener(name, listener);
        this.setRatio(this.ratio);
    }

    setRatio(ratio) {
        this.ratio = Math.max(0.2, Math.min(0.8, ratio));
        this.body.style.setProperty("--pw-git-files-ratio", `${this.ratio}fr`);
        this.body.style.setProperty("--pw-git-message-ratio", `${1 - this.ratio}fr`);
        this.handle.setAttribute("aria-valuenow", String(Math.round(this.ratio * 100)));
    }

    start(event) {
        if (event.button !== 0 || this.pointerId !== undefined) return;
        event.preventDefault();
        this.pointerId = event.pointerId;
        this.handle.setPointerCapture(event.pointerId);
        this.handle.focus({ preventScroll: true });
        this.body.classList.add("is-resizing");
    }

    move(event) {
        if (event.pointerId !== this.pointerId) return;
        const bounds = this.body.getBoundingClientRect();
        if (bounds.height <= 1) return;
        this.setRatio((event.clientY - bounds.top) / (bounds.height - 1));
    }

    stop() {
        const pointerId = this.pointerId;
        this.pointerId = undefined;
        this.body.classList.remove("is-resizing");
        if (pointerId !== undefined && this.handle.hasPointerCapture(pointerId)) this.handle.releasePointerCapture(pointerId);
    }

    keydown(event) {
        const ratios = { ArrowUp: this.ratio - 0.05, ArrowDown: this.ratio + 0.05, Home: 0.2, End: 0.8 };
        if (!(event.key in ratios)) return;
        event.preventDefault();
        this.setRatio(ratios[event.key]);
    }

    dispose() {
        this.stop();
        for (const [name, listener] of Object.entries(this.listeners)) this.handle.removeEventListener(name, listener);
    }
}
