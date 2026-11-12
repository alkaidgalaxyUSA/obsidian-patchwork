/** Overlay thumbs share document scrolling without reserving a track background. */
export function overlayScrollbar(viewport, host, registerCleanup, axis = "vertical") {
    const win = viewport.ownerDocument.defaultView;
    const horizontal = axis === "horizontal";
    const leftGutter = !horizontal && viewport.classList.contains("pw-diff-document-left");
    const rtl = horizontal && win.getComputedStyle(viewport).direction === "rtl";
    const track = host.createDiv({ cls: "pw-diff-overlay-scrollbar", attr: { "aria-hidden": "true" } });
    track.classList.toggle("pw-diff-overlay-horizontal", horizontal);
    const thumb = track.createDiv({ cls: "pw-diff-overlay-thumb" });
    const extent = () => horizontal ? viewport.scrollWidth - viewport.clientWidth : viewport.scrollHeight - viewport.clientHeight;
    const position = () => horizontal ? viewport.scrollLeft + (rtl ? extent() : 0) : viewport.scrollTop;
    let drag, frame;
    const paint = () => {
        frame = undefined;
        const rect = viewport.getBoundingClientRect(), origin = host.getBoundingClientRect();
        const visible = horizontal ? viewport.clientWidth : viewport.clientHeight;
        // Keep the horizontal thumb 3px before the right vertical thumb (7px wide, 4px inset).
        const rightInset = horizontal && !rtl && viewport.scrollHeight > viewport.clientHeight ? 14 : 0;
        const length = Math.max(0, horizontal ? visible - rightInset : rect.height - 3), max = extent();
        if (horizontal) {
            Object.assign(track.style, { left: `${rect.left - origin.left + viewport.clientLeft}px`, top: `${rect.bottom - origin.top - 10}px`, width: `${length}px` });
        } else {
            track.style.height = `${length}px`;
            if (leftGutter) Object.assign(track.style, { left: `${rect.left - origin.left + (viewport.clientLeft - 7) / 2}px`, right: "auto" });
        }
        track.hidden = max <= 0;
        const size = Math.min(length, Math.max(24, length * visible / (max + visible)));
        thumb.style[horizontal ? "width" : "height"] = `${size}px`;
        thumb.style.transform = `translate${horizontal ? "X" : "Y"}(${max > 0 ? position() / max * (length - size) : 0}px)`;
    };
    const update = () => { if (frame === undefined) frame = win.requestAnimationFrame(paint); };
    const stop = () => {
        const id = drag?.id;
        drag = undefined;
        if (id !== undefined && thumb.hasPointerCapture(id)) thumb.releasePointerCapture(id);
    };
    const down = event => {
        if (event.button !== 0) return;
        drag = { id: event.pointerId, coordinate: horizontal ? event.clientX : event.clientY, position: position() };
        thumb.setPointerCapture(event.pointerId);
        event.preventDefault(); event.stopPropagation();
    };
    const move = event => {
        if (drag?.id !== event.pointerId) return;
        const travel = horizontal ? track.clientWidth - thumb.offsetWidth : track.clientHeight - thumb.offsetHeight;
        if (travel <= 0) return;
        const next = Math.max(0, Math.min(extent(), drag.position + ((horizontal ? event.clientX : event.clientY) - drag.coordinate) * extent() / travel));
        if (horizontal) viewport.scrollLeft = next - (rtl ? extent() : 0);
        else viewport.scrollTop = next;
    };
    const listeners = { pointerdown: down, pointermove: move, pointerup: stop, pointercancel: stop, lostpointercapture: stop };
    for (const [event, listener] of Object.entries(listeners)) thumb.addEventListener(event, listener);
    viewport.addEventListener("scroll", update, { passive: true });
    const observer = new win.ResizeObserver(update);
    observer.observe(viewport);
    update();
    registerCleanup(() => {
        stop(); observer.disconnect();
        if (frame !== undefined) win.cancelAnimationFrame(frame);
        viewport.removeEventListener("scroll", update);
        for (const [event, listener] of Object.entries(listeners)) thumb.removeEventListener(event, listener);
        track.remove();
    });
}
