import { readOnlyCaret } from "./read-only-caret";
import { overlayScrollbar } from "./overlay-scrollbar";
import { diffConnectors } from "./diff-connectors";
import { synchronizedScroll } from "./diff-blocks";
import { smoothDiffScroll } from "./smooth-diff-scroll";
import { diffStripe } from "./diff-stripe";

/** Both surfaces share the same independent documents, gutters and geometry. */
export function splitDocuments(output, blocks, registerCleanup, options = {}) {
    if (!blocks.length || !blocks[0].querySelector(".pw-diff-pair")) return;
    const documents = output.createDiv({ cls: "pw-diff-documents" });
    blocks[0].before(documents);
    const left = documents.createDiv({ cls: "pw-diff-document pw-diff-document-left" });
    const leftNumbers = documents.createDiv({ cls: "pw-diff-numbers pw-diff-numbers-left" });
    const center = documents.createDiv({ cls: "pw-diff-center-space" });
    const rightNumbers = documents.createDiv({ cls: "pw-diff-numbers pw-diff-numbers-right" });
    const right = documents.createDiv({ cls: "pw-diff-document pw-diff-document-right" });
    const leftTrack = leftNumbers.createDiv(), rightTrack = rightNumbers.createDiv();
    const pairs = [], changes = [], scrollBlocks = [];
    const aligned = options.align === true;
    documents.classList.toggle("is-unaligned", !aligned);
    for (const block of blocks) {
        const peer = right.createDiv({ cls: "pw-diff-hunk-peer" });
        // Preserve patch operations on either side without copying interactive nodes.
        const forwardMenu = event => {
            event.preventDefault();
            block.dispatchEvent(new output.ownerDocument.defaultView.MouseEvent("contextmenu", {
                bubbles: true, clientX: event.clientX, clientY: event.clientY,
            }));
        };
        const forwardKey = event => {
            if (event.key !== "F10" || !event.shiftKey) return;
            const rect = event.target.getBoundingClientRect();
            forwardMenu({ preventDefault: () => event.preventDefault(), clientX: rect.left, clientY: rect.top });
        };
        peer.addEventListener("keydown", forwardKey);
        registerCleanup(() => peer.removeEventListener("keydown", forwardKey));
        peer.addEventListener("contextmenu", forwardMenu);
        registerCleanup(() => peer.removeEventListener("contextmenu", forwardMenu));
        for (const group of [...block.children]) {
            const scrollBlock = { start: pairs.length, end: pairs.length };
            scrollBlocks.push(scrollBlock);
            const opposite = peer.createDiv({ cls: group.className });
            opposite.dataset.blockId = group.dataset.blockId;
            opposite.dataset.diffType = group.dataset.diffType;
            if (group.dataset.diffChange) opposite.tabIndex = 0;
            if (group.dataset.diffChange) changes.push({ left: group, right: opposite, type: group.dataset.diffType });
            for (const row of [...group.querySelectorAll(".pw-diff-pair")]) {
                const a = row.firstElementChild, b = row.lastElementChild;
                a.querySelector(".pw-diff-line-number")?.remove(); b.querySelector(".pw-diff-line-number")?.remove();
                group.append(a); opposite.append(b); row.remove();
                const an = leftTrack.createDiv({ text: a.dataset.lineNumber });
                const bn = rightTrack.createDiv({ text: b.dataset.lineNumber });
                an.className = `pw-diff-number${a.classList.contains("pw-diff-empty") ? "" : ` pw-diff-${group.dataset.diffType}`}`;
                bn.className = `pw-diff-number${b.classList.contains("pw-diff-empty") ? "" : ` pw-diff-${group.dataset.diffType}`}`;
                if (!a.classList.contains("pw-diff-empty") && a.classList.contains("pw-diff-inner")) an.classList.add("pw-diff-inner");
                if (!b.classList.contains("pw-diff-empty") && b.classList.contains("pw-diff-inner")) bn.classList.add("pw-diff-inner");
                pairs.push({ a, b, an, bn });
            }
            scrollBlock.end = pairs.length;
        }
        left.append(block);
    }
    for (const surface of [left, right, leftTrack, rightTrack]) {
        surface.createDiv({ cls: "pw-diff-scroll-tail", attr: { "aria-hidden": "true" } });
    }
    readOnlyCaret(left, documents, registerCleanup);
    readOnlyCaret(right, documents, registerCleanup);
    for (const side of [left, right]) {
        overlayScrollbar(side, documents, registerCleanup);
        overlayScrollbar(side, documents, registerCleanup, "horizontal");
    }
    const paint = diffConnectors(center, left, right, changes, registerCleanup);
    let layoutFrame, scrollMotion, peerTransition, disposed = false;
    const win = output.ownerDocument.defaultView;
    const max = element => Math.max(0, element.scrollWidth - element.clientWidth);
    const logicalX = element => element === left ? max(left) + left.scrollLeft : element.scrollLeft;
    const setX = (element, value) => { element.scrollLeft = element === left ? value - max(left) : value; };
    const updateNumbers = () => {
        leftNumbers.scrollTop = left.scrollTop; rightNumbers.scrollTop = right.scrollTop;
    };
    let leftAnchors = [], rightAnchors = [], lineHeight = 20;
    const scrollPositions = new WeakMap();
    const stripeUpdates = [];
    const rememberPositions = () => {
        for (const side of [left, right]) scrollPositions.set(side, { y: side.scrollTop, x: side.scrollLeft });
    };
    const layout = () => {
        layoutFrame = undefined;
        if (disposed || !documents.isConnected || !left.clientWidth) return;
        scrollMotion?.cancel();
        peerTransition = undefined;
        const positions = [left.scrollTop, right.scrollTop];
        lineHeight = Number.parseFloat(win.getComputedStyle(left).getPropertyValue("--pw-diff-line-height")) || 20;
        for (const { a, b } of pairs) { a.style.minHeight = ""; b.style.minHeight = ""; }
        const heights = pairs.map(({ a, b }) => [a.getBoundingClientRect().height, b.getBoundingClientRect().height]);
        const offsets = [[0, 0]];
        let y1 = 0, y2 = 0;
        pairs.forEach(({ a, b, an, bn }, index) => {
            const [h1, h2] = heights[index];
            const ah = aligned ? Math.max(h1, h2) : h1, bh = aligned ? Math.max(h1, h2) : h2;
            a.style.minHeight = `${ah}px`; b.style.minHeight = `${bh}px`;
            an.style.height = `${ah}px`; bn.style.height = `${bh}px`;
            y1 += ah; y2 += bh;
            offsets.push([y1, y2]);
        });
        // Match whole diff-block boundaries, not similarity-paired display rows.
        // Heights already include soft wraps and visible folded-context markers.
        leftAnchors = [[0, 0], ...scrollBlocks.flatMap(block => [offsets[block.start], offsets[block.end]])];
        rightAnchors = leftAnchors.map(([a, b]) => [b, a]);
        left.scrollTop = positions[0]; right.scrollTop = positions[1];
        if (!left.dataset.initialized) {
            left.dataset.initialized = "true"; setX(left, 0);
            [left, right].forEach((side, index) => { if (options.position?.[index]) { side.scrollTop = options.position[index][0]; side.scrollLeft = options.position[index][1]; } });
        }
        if (aligned) right.scrollTop = left.scrollTop;
        rememberPositions(); updateNumbers(); paint();
        for (const update of stripeUpdates) update();
    };
    const scheduleLayout = () => { if (!disposed && layoutFrame === undefined) layoutFrame = win.requestAnimationFrame(layout); };
    const sync = current => {
        const last = scrollPositions.get(current);
        const vertical = !last || Math.abs(last.y - current.scrollTop) > 0.01;
        const horizontal = !last || Math.abs(last.x - current.scrollLeft) > 0.01;
        if (!vertical && !horizontal) return;
        scrollMotion?.cancel();
        peerTransition = undefined;
        if (options.sync !== false || aligned) {
            const target = current === left ? right : left;
            if (vertical) {
                target.scrollTop = aligned ? current.scrollTop
                    : synchronizedScroll(current.scrollTop, current.clientHeight, target.scrollTop, lineHeight,
                        current === left ? leftAnchors : rightAnchors);
            }
            if (horizontal) setX(target, logicalX(current));
        }
        // Remember both results, including browser-clamped offsets. Queued scroll
        // events from either write must not reverse-map the waiting side back.
        rememberPositions(); updateNumbers(); paint();
    };
    scrollMotion = smoothDiffScroll(documents, current => ({
        x: logicalX(current), y: current.scrollTop,
        maxX: max(current), maxY: Math.max(0, current.scrollHeight - current.clientHeight),
    }), (current, position, transition) => {
        const previousY = current.scrollTop;
        current.scrollTop = position.y;
        setX(current, position.x);
        if (options.sync !== false || aligned) {
            const target = current === left ? right : left;
            if (transition.vertical) {
                const mapped = aligned ? current.scrollTop
                    : synchronizedScroll(current.scrollTop, current.clientHeight,
                        peerTransition?.source === current ? peerTransition.destination : target.scrollTop, lineHeight,
                        current === left ? leftAnchors : rightAnchors);
                const destination = Math.max(0, Math.min(target.scrollHeight - target.clientHeight, mapped));
                if (!peerTransition || peerTransition.source !== current) {
                    peerTransition = { source: current, destination: target.scrollTop, offset: 0 };
                }
                // Ordinary corresponding lines move together. Ease only a jump
                // in the mapping, rather than making one whole document lag.
                const travel = Math.abs(current.scrollTop - previousY);
                if (Math.abs(destination - peerTransition.destination) > travel + lineHeight / 2) {
                    peerTransition.offset = target.scrollTop - destination;
                }
                peerTransition.destination = destination;
                peerTransition.offset = aligned || transition.settled ? 0
                    : peerTransition.offset * (1 - transition.blend);
                if (Math.abs(peerTransition.offset) < 0.5) peerTransition.offset = 0;
                target.scrollTop = destination + peerTransition.offset;
            }
            if (transition.horizontal) setX(target, logicalX(current));
        }
        // Paint from the actual positions after both writes, never animate SVG
        // endpoints independently of their document highlights and gutter lines.
        rememberPositions(); updateNumbers(); paint();
        return !!peerTransition?.offset;
    }, registerCleanup);
    const positioned = () => { scrollMotion.cancel(); peerTransition = undefined; rememberPositions(); updateNumbers(); paint(); };
    documents.addEventListener("pw-diff-positioned", positioned);
    const wheel = (event, current) => {
        // Native compositor scrolling can present one document before its scroll
        // event reaches JS. Own wheel movement so every surface paints together.
        if (event.defaultPrevented || event.ctrlKey || event.metaKey || !event.cancelable) return;
        event.preventDefault();
        const xUnit = event.deltaMode === 1 ? lineHeight : event.deltaMode === 2 ? current.clientWidth : 1;
        const yUnit = event.deltaMode === 1 ? lineHeight : event.deltaMode === 2 ? current.clientHeight : 1;
        const horizontal = event.shiftKey && event.deltaX === 0;
        const dx = horizontal ? event.deltaY * xUnit : event.deltaX * xUnit;
        const dy = horizontal ? 0 : event.deltaY * yUnit;
        if (!scrollMotion.isActive() || peerTransition?.source !== current) peerTransition = undefined;
        scrollMotion.move(current, dx, dy);
    };
    const wheelLeft = event => wheel(event, left), wheelRight = event => wheel(event, right);
    for (const [side, key] of [[left, "left"], [right, "right"]]) {
        stripeUpdates.push(diffStripe(side, documents, changes.map(change => ({ group: change[key], type: change.type })), registerCleanup,
            (group, firstCell) => {
                scrollMotion.cancel(); peerTransition = undefined;
                const y = (firstCell ?? group).getBoundingClientRect().top - side.getBoundingClientRect().top + side.scrollTop;
                side.scrollTop = Math.max(0, y - side.clientHeight / 2 + lineHeight / 2);
                // Use the clicked editor as the source. Disabled sync leaves its peer alone.
                sync(side);
                updateNumbers(); paint();
            }, event => wheel(event, side)));
    }
    for (const surface of [left, leftNumbers]) surface.addEventListener("wheel", wheelLeft, { passive: false });
    for (const surface of [right, rightNumbers]) surface.addEventListener("wheel", wheelRight, { passive: false });
    const syncLeft = () => sync(left), syncRight = () => sync(right);
    left.addEventListener("scroll", syncLeft, { passive: true }); right.addEventListener("scroll", syncRight, { passive: true });
    const observer = new win.ResizeObserver(scheduleLayout);
    observer.observe(left); observer.observe(right);
    // Observe text only: measuring our own spacer writes must not schedule a loop.
    for (const element of documents.querySelectorAll(".pw-diff-cell-content")) observer.observe(element);
    scheduleLayout();
    registerCleanup(() => {
        disposed = true; observer.disconnect();
        documents.removeEventListener("pw-diff-positioned", positioned);
        if (layoutFrame !== undefined) win.cancelAnimationFrame(layoutFrame);
        left.removeEventListener("scroll", syncLeft); right.removeEventListener("scroll", syncRight);
        for (const surface of [left, leftNumbers]) surface.removeEventListener("wheel", wheelLeft);
        for (const surface of [right, rightNumbers]) surface.removeEventListener("wheel", wheelRight);
    });
}
