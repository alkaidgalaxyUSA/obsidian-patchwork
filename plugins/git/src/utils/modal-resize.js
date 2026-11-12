/** Invisible edge targets keep resizing separate from text selection and title dragging. */
export function enableModalResize(modal) {
    const win = modal.ownerDocument.defaultView;
    const disposers = [];
    for (const edge of ["n", "s", "e", "w", "nw", "ne", "sw", "se"]) {
        const handle = modal.createDiv({ cls: "pw-diff-resize-edge", attr: { "data-edge": edge, "aria-hidden": "true" } });
        let drag;
        const stop = () => {
            const id = drag?.id;
            drag = undefined;
            if (id !== undefined && handle.hasPointerCapture(id)) handle.releasePointerCapture(id);
        };
        const down = event => {
            if (event.button !== 0) return;
            const rect = modal.getBoundingClientRect();
            drag = { id: event.pointerId, x: event.clientX, y: event.clientY, rect };
            handle.setPointerCapture(event.pointerId);
            event.preventDefault();
            event.stopPropagation();
        };
        const move = event => {
            if (drag?.id !== event.pointerId) return;
            const r = drag.rect, dx = event.clientX - drag.x, dy = event.clientY - drag.y;
            const minWidth = Math.min(700, win.innerWidth * .96), minHeight = Math.min(320, win.innerHeight * .94);
            const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
            let { left, right, top, bottom } = r;
            if (edge.includes("w")) left = clamp(r.left + dx, Math.max(0, right - win.innerWidth * .96), right - minWidth);
            if (edge.includes("e")) right = clamp(r.right + dx, left + minWidth, Math.min(win.innerWidth, left + win.innerWidth * .96));
            if (edge.includes("n")) top = clamp(r.top + dy, Math.max(0, bottom - win.innerHeight * .94), bottom - minHeight);
            if (edge.includes("s")) bottom = clamp(r.bottom + dy, top + minHeight, Math.min(win.innerHeight, top + win.innerHeight * .94));
            Object.assign(modal.style, { position: "fixed", margin: "0", transform: "none", left: `${left}px`, top: `${top}px`, width: `${right - left}px`, height: `${bottom - top}px` });
        };
        const listeners = { pointerdown: down, pointermove: move, pointerup: stop, pointercancel: stop, lostpointercapture: stop };
        for (const [name, listener] of Object.entries(listeners)) handle.addEventListener(name, listener);
        disposers.push(() => {
            stop();
            for (const [name, listener] of Object.entries(listeners)) handle.removeEventListener(name, listener);
            handle.remove();
        });
    }
    return () => disposers.forEach(dispose => dispose());
}
