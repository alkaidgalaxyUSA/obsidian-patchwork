/** Keep dragging local to the modal's document and release capture on close. */
export function enableModalDrag(modal, handle) {
    let drag;
    const stop = () => {
        const id = drag?.id;
        drag = undefined;
        if (id !== undefined && handle.hasPointerCapture(id)) handle.releasePointerCapture(id);
    };
    const down = event => {
        if (event.button !== 0 || event.target.closest("button, input, a")) return;
        const rect = modal.getBoundingClientRect();
        drag = { id: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
        handle.setPointerCapture(event.pointerId);
        event.preventDefault();
    };
    const move = event => {
        if (drag?.id !== event.pointerId) return;
        const win = modal.ownerDocument.defaultView;
        const left = Math.max(0, Math.min(win.innerWidth - modal.offsetWidth, drag.left + event.clientX - drag.x));
        const top = Math.max(0, Math.min(win.innerHeight - modal.offsetHeight, drag.top + event.clientY - drag.y));
        Object.assign(modal.style, { position: "fixed", margin: "0", transform: "none", left: `${left}px`, top: `${top}px` });
    };
    const listeners = { pointerdown: down, pointermove: move, pointerup: stop, pointercancel: stop, lostpointercapture: stop };
    for (const [name, listener] of Object.entries(listeners)) handle.addEventListener(name, listener);
    return () => { stop(); for (const [name, listener] of Object.entries(listeners)) handle.removeEventListener(name, listener); };
}
