import { overlayScrollbar } from "./overlay-scrollbar";
import { readOnlyCaret } from "./read-only-caret";
import { diffStripe } from "./diff-stripe";
import { smoothDiffScroll } from "./smooth-diff-scroll";

/** Added/deleted files have one revision, so show one full-width document. */
export function singleDocument(output, blocks, registerCleanup, options) {
    if (!blocks.length) return;
    const host = output.createDiv({ cls: "pw-diff-documents pw-diff-single-document" });
    blocks[0].before(host);
    const numbers = host.createDiv({ cls: "pw-diff-numbers pw-diff-numbers-right" });
    const viewport = host.createDiv({ cls: "pw-diff-document pw-diff-document-right" });
    const track = numbers.createDiv(), pairs = [], changes = [];
    for (const block of blocks) {
        for (const group of [...block.children]) {
            for (const row of [...group.querySelectorAll(".pw-diff-pair")]) {
                const cell = options.deleted ? row.firstElementChild : row.lastElementChild;
                cell.querySelector(".pw-diff-line-number")?.remove();
                group.append(cell); row.remove();
                const number = track.createDiv({ cls: "pw-diff-number", text: cell.dataset.lineNumber });
                number.classList.add(options.deleted ? "pw-diff-del" : "pw-diff-add");
                pairs.push({ cell, number });
            }
            if (group.dataset.diffChange) changes.push({ group, type: group.dataset.diffType });
        }
        viewport.append(block);
    }
    for (const surface of [viewport, track]) surface.createDiv({ cls: "pw-diff-scroll-tail", attr: { "aria-hidden": "true" } });
    readOnlyCaret(viewport, host, registerCleanup);
    overlayScrollbar(viewport, host, registerCleanup);
    overlayScrollbar(viewport, host, registerCleanup, "horizontal");
    const win = output.ownerDocument.defaultView;
    let frame, disposed = false, initialized = false, lastY = 0, lastX = 0;
    const remember = () => { lastY = viewport.scrollTop; lastX = viewport.scrollLeft; numbers.scrollTop = lastY; };
    const motion = smoothDiffScroll(host, () => ({ x: viewport.scrollLeft, y: viewport.scrollTop,
        maxX: Math.max(0, viewport.scrollWidth - viewport.clientWidth), maxY: Math.max(0, viewport.scrollHeight - viewport.clientHeight) }),
    (_current, position) => { viewport.scrollTop = position.y; viewport.scrollLeft = position.x; remember(); return false; }, registerCleanup);
    const wheel = event => {
        if (event.defaultPrevented || event.ctrlKey || event.metaKey || !event.cancelable) return;
        event.preventDefault();
        const line = Number.parseFloat(win.getComputedStyle(viewport).getPropertyValue("--pw-diff-line-height")) || 20;
        const xUnit = event.deltaMode === 1 ? line : event.deltaMode === 2 ? viewport.clientWidth : 1;
        const yUnit = event.deltaMode === 1 ? line : event.deltaMode === 2 ? viewport.clientHeight : 1;
        const horizontal = event.shiftKey && event.deltaX === 0;
        motion.move(viewport, (horizontal ? event.deltaY : event.deltaX) * xUnit, horizontal ? 0 : event.deltaY * yUnit);
    };
    const stripe = diffStripe(viewport, host, changes, registerCleanup, (group, firstCell) => {
        motion.cancel();
        const line = Number.parseFloat(win.getComputedStyle(viewport).getPropertyValue("--pw-diff-line-height")) || 20;
        viewport.scrollTop += (firstCell ?? group).getBoundingClientRect().top - viewport.getBoundingClientRect().top - viewport.clientHeight / 2 + line / 2;
        remember();
    }, wheel);
    const layout = () => {
        frame = undefined;
        if (disposed || !host.isConnected || !viewport.clientWidth) return;
        motion.cancel();
        const heights = pairs.map(({ cell }) => cell.getBoundingClientRect().height);
        pairs.forEach(({ number }, index) => { number.style.height = `${heights[index]}px`; });
        if (!initialized) {
            initialized = true;
            const position = options.position?.[0];
            if (position) { viewport.scrollTop = position[0]; viewport.scrollLeft = position[1]; }
        }
        remember(); stripe();
    };
    const schedule = () => { if (!disposed && frame === undefined) frame = win.requestAnimationFrame(layout); };
    const scroll = () => { if (lastY !== viewport.scrollTop || lastX !== viewport.scrollLeft) motion.cancel(); remember(); };
    const positioned = () => { motion.cancel(); remember(); };
    viewport.addEventListener("scroll", scroll, { passive: true });
    host.addEventListener("pw-diff-positioned", positioned);
    for (const surface of [viewport, numbers]) surface.addEventListener("wheel", wheel, { passive: false });
    const observer = new win.ResizeObserver(schedule);
    observer.observe(viewport);
    for (const element of viewport.querySelectorAll(".pw-diff-cell-content")) observer.observe(element);
    registerCleanup(() => {
        disposed = true; observer.disconnect();
        if (frame !== undefined) win.cancelAnimationFrame(frame);
        viewport.removeEventListener("scroll", scroll);
        host.removeEventListener("pw-diff-positioned", positioned);
        for (const surface of [viewport, numbers]) surface.removeEventListener("wheel", wheel);
    });
    schedule();
}
