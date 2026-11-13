/** Map visual diff ranges onto a fixed scrollbar lane, independently per editor. */
export function diffStripe(viewport, host, changes, registerCleanup, navigate, wheel) {
    if (!changes.length) return () => {};
    const doc = viewport.ownerDocument, win = doc.defaultView;
    const lane = host.createDiv({ cls: "pw-diff-stripe" });
    const mirrored = viewport.classList.contains("pw-diff-document-left");
    const minimum = 3;
    let disposed = false;
    const markers = changes.map(({ group, type }) => {
        const cells = [...group.children].filter(cell => !cell.classList.contains("pw-diff-empty"));
        const mark = lane.createDiv({ cls: `pw-diff-stripe-mark pw-diff-stripe-${type}`, attr: {
            role: "button", tabindex: "0", "aria-label": `Go to ${type === "add" ? "insertion" : type === "del" ? "deletion" : "modification"}`,
        } });
        return { group, cells, mark, top: 0, bottom: 0 };
    });
    const update = () => {
        if (disposed || !host.isConnected || !viewport.clientHeight) return;
        const bounds = viewport.getBoundingClientRect(), origin = host.getBoundingClientRect();
        const length = Math.max(0, viewport.clientHeight - 3);
        const scale = Math.min(1, length / Math.max(1, viewport.scrollHeight));
        // Center the 13px marks over the existing 7px thumb, not beside it.
        const width = 13;
        const x = mirrored ? bounds.left + (viewport.clientLeft - width) / 2 : bounds.right - 14;
        Object.assign(lane.style, { left: `${x - origin.left}px`, top: `${bounds.top - origin.top + viewport.clientTop}px`, width: `${width}px`, height: `${length}px` });
        // Read all document geometry before writing marker positions.
        const ranges = markers.map(marker => {
            const start = (marker.cells[0] ?? marker.group).getBoundingClientRect().top;
            const end = marker.cells.length ? marker.cells.at(-1).getBoundingClientRect().bottom : start;
            const top = Math.max(0, Math.min(Math.max(0, length - minimum), (start - bounds.top - viewport.clientTop + viewport.scrollTop) * scale));
            return { top, bottom: Math.min(length, Math.max(top + minimum, (end - bounds.top - viewport.clientTop + viewport.scrollTop) * scale)) };
        });
        markers.forEach((marker, index) => {
            Object.assign(marker, ranges[index]);
            marker.mark.style.top = `${marker.top}px`;
            marker.mark.style.height = `${marker.bottom - marker.top}px`;
        });
        if (host.classList.contains("pw-diff-single-document")) viewport.dispatchEvent(new win.Event("pw-diff-stripe-layout"));
    };
    const nearest = event => {
        const y = event.clientY - lane.getBoundingClientRect().top;
        return markers.filter(marker => y >= marker.top - minimum * 2 && y <= marker.bottom + minimum * 2)
            .reduce((best, marker) => !best || Math.abs(marker.top - y) < Math.abs(best.top - y) ? marker : best, undefined);
    };
    const activate = marker => {
        const start = marker.cells[0]?.querySelector(".pw-diff-cell-content") ?? marker.cells[0] ?? marker.group.firstElementChild ?? marker.group;
        // Collapse the selection at the real text start (or the empty-side anchor).
        viewport.focus({ preventScroll: true });
        const selection = doc.getSelection(), range = doc.createRange();
        range.selectNodeContents(start); range.collapse(true);
        selection?.removeAllRanges(); selection?.addRange(range);
        navigate(marker.group, marker.cells[0]);
    };
    const click = event => {
        if (event.button !== 0) return;
        update();
        const marker = nearest(event);
        if (!marker) return;
        event.preventDefault(); event.stopPropagation(); activate(marker);
    };
    const down = event => { if (event.button === 0) event.preventDefault(); };
    const thumbClick = event => {
        update();
        const marker = nearest(event.detail);
        if (marker) activate(marker);
    };
    const move = event => { lane.style.cursor = nearest(event) ? "pointer" : "default"; };
    const key = event => {
        if (event.key !== "Enter" && event.key !== " ") return;
        const marker = markers.find(item => item.mark === event.target);
        if (!marker) return;
        event.preventDefault(); event.stopPropagation(); activate(marker);
    };
    const listeners = { click, pointerdown: down, pointermove: move, keydown: key, wheel };
    for (const [type, listener] of Object.entries(listeners)) lane.addEventListener(type, listener, { passive: false });
    viewport.addEventListener("pw-diff-stripe-activate", thumbClick);
    registerCleanup(() => {
        disposed = true;
        for (const [type, listener] of Object.entries(listeners)) lane.removeEventListener(type, listener);
        viewport.removeEventListener("pw-diff-stripe-activate", thumbClick);
        lane.remove();
    });
    return update;
}
