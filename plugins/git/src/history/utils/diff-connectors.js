/** Geometry comes from the same blocks as the highlights, never from line numbers. */
export function diffConnectors(host, left, right, changes, registerCleanup) {
    const doc = host.ownerDocument, ns = "http://www.w3.org/2000/svg";
    const svg = doc.createElementNS(ns, "svg");
    svg.setAttribute("aria-hidden", "true"); host.append(svg);
    const boundaries = [];
    const boundary = (cells, side, type) => {
        if (cells.length) return;
        const line = doc.createElement("div");
        line.className = `pw-diff-boundary pw-diff-boundary-${type}`;
        line.setAttribute("aria-hidden", "true");
        line.dataset.side = side;
        line.hidden = true;
        host.parentElement.append(line);
        boundaries.push(line);
        return line;
    };
    const paths = changes.map(change => {
        const path = doc.createElementNS(ns, "path");
        path.setAttribute("class", `pw-diff-connector pw-diff-connector-${change.type}`);
        const range = group => [...group.children].filter(cell => !cell.classList.contains("pw-diff-empty"));
        const leftCells = range(change.left), rightCells = range(change.right);
        svg.append(path);
        return { ...change, path, leftCells, rightCells,
            leftBoundary: boundary(leftCells, "left", change.type),
            rightBoundary: boundary(rightCells, "right", change.type) };

    });
    const bounds = (group, cells, surface) => {
        if (!cells.length) {
            const anchor = group.getBoundingClientRect().top;
            // Keep the empty-side end face as thick as its boundary line. Share
            // its viewport-edge placement so both filled shapes meet exactly.
            const top = anchor >= surface.top && anchor <= surface.bottom ? Math.min(anchor, surface.bottom - 2) : anchor;
            return { top, bottom: top + 2 };
        }
        return { top: cells[0].getBoundingClientRect().top, bottom: cells.at(-1).getBoundingClientRect().bottom };
    };
    // Overlay the viewport and gutter so a zero-line range stays visible even
    // when alignment is disabled, without adding a row or changing scroll height.
    const paintBoundary = (line, y, surface, start, end, origin) => {
        if (!line) return;
        const hidden = y < surface.top || y > surface.bottom;
        if (line.hidden !== hidden) line.hidden = hidden;
        if (hidden) return;
        const values = { left: `${start - origin.left}px`, top: `${y - origin.top}px`, width: `${end - start}px` };
        for (const [name, value] of Object.entries(values)) {
            if (line.style[name] !== value) line.style[name] = value;
        }
    };
    const paint = () => {
        const rect = host.getBoundingClientRect(), width = rect.width, height = rect.height;
        const origin = host.parentElement.getBoundingClientRect();
        const leftRect = left.getBoundingClientRect(), rightRect = right.getBoundingClientRect();
        for (const change of paths) {
            const a = bounds(change.left, change.leftCells, leftRect), b = bounds(change.right, change.rightCells, rightRect);
            paintBoundary(change.leftBoundary, a.top, leftRect, leftRect.left + left.clientLeft, rect.left, origin);
            paintBoundary(change.rightBoundary, b.top, rightRect, rect.right, rightRect.left + right.clientLeft + right.clientWidth, origin);
            const y1 = a.top - rect.top, y2 = b.top - rect.top;
            const e1 = a.bottom - rect.top, e2 = b.bottom - rect.top;
            const visible = Math.max(e1, e2) >= 0 && Math.min(y1, y2) <= height;
            const d = visible ? `M0,${y1} C${width / 2},${y1} ${width / 2},${y2} ${width},${y2} L${width},${e2} C${width / 2},${e2} ${width / 2},${e1} 0,${e1} Z` : "";
            if (change.path.getAttribute("d") !== d) change.path.setAttribute("d", d);

        }
    };
    registerCleanup(() => { svg.remove(); boundaries.forEach(line => line.remove()); });
    return paint;
}
