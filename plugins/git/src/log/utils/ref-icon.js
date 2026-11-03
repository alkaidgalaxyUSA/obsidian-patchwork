// Geometry adapted from JetBrains TagPainter.kt and LabelIcon.java.
// Copyright 2000-2023 JetBrains s.r.o. and contributors. Apache-2.0.
// Reference: intellij-community 8eee455aa813af4ad427fd576b0ad8d94c418577.
const outline = "M13.4495 7.5001L7.01028 13.9394C6.81502 14.1347 6.49843 14.1347 6.30317 13.9394L2.06053 9.69679C1.86527 9.50152 1.86527 9.18494 2.06053 8.98968L8.49978 2.55035C8.61106 2.43907 8.76824 2.38667 8.92404 2.40893L12.6363 2.93926C12.8563 2.97069 13.0292 3.14354 13.0606 3.36352L13.5909 7.07584C13.6132 7.23163 13.5608 7.38882 13.4495 7.5001Z";
const colors = { head: "#F5D273", branch: "#5FAD65", remote: "#B589EC", tag: "#868A91" };

/** Log labels are painted tags, not the branch tree or tool-window icons. */
export function renderRefIcon(host, refs) {
    // The history adapter combines HEAD and its current branch into one ref.
    const types = Object.keys(colors).filter(type => refs.some(ref => ref.type === type
        || (type === "branch" && ref.current && ref.name !== "HEAD")));
    if (!types.length) return;
    const palette = types.map(type => colors[type]);
    const step = 16 / 6.25 * 2;
    const width = Math.round(16 + step * (palette.length - 1));
    const svg = host.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add("pw-log-ref-icon");
    svg.setAttribute("viewBox", `0 0 ${width} 16`);
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", "16");
    svg.setAttribute("aria-hidden", "true");
    const tag = (offset, color, dot) => {
        const path = host.ownerDocument.createElementNS(svg.namespaceURI, "path");
        path.setAttribute("d", outline);
        path.setAttribute("transform", `translate(${offset} 0)`);
        path.setAttribute("fill", "var(--pw-log-ref-background)");
        path.setAttribute("stroke", color);
        path.setAttribute("stroke-width", "1");
        path.setAttribute("stroke-linejoin", "round");
        path.setAttribute("stroke-linecap", "round");
        svg.append(path);
        if (!dot) return;
        const circle = host.ownerDocument.createElementNS(svg.namespaceURI, "circle");
        circle.setAttribute("cx", String(10.5 + offset));
        circle.setAttribute("cy", "5.5");
        circle.setAttribute("r", "1");
        circle.setAttribute("fill", color);
        circle.setAttribute("stroke", "none");
        svg.append(circle);
    };
    palette.reverse().forEach((color, index) => {
        const last = index === palette.length - 1;
        tag(step * index, color, last);
        if (!last) tag(step * (index + 1) - Math.SQRT2, "var(--pw-log-ref-background)", false);
    });
    host.append(svg);
}
