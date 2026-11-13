/** Display changes are smaller than Git hunks; keep the patch identity intact. */
export function diffBlocks(hunk, fileIndex = 0, hunkIndex = 0) {
    const blocks = [];
    let oldLine = hunk.oldStart + (hunk.oldLines === 0 ? 1 : 0);
    let newLine = hunk.newStart + (hunk.newLines === 0 ? 1 : 0);
    for (const line of hunk.lines) {
        if (line.oldLineNo !== undefined) oldLine = line.oldLineNo;
        if (line.newLineNo !== undefined) newLine = line.newLineNo;
        const context = line.type === "context";
        let block = blocks.at(-1);
        if (!block || (block.type === "context") !== context) {
            block = { id: `${fileIndex}:${hunkIndex}:${blocks.length}`, fileIndex, hunkIndex,
                type: context ? "context" : "modify", oldStart: oldLine, newStart: newLine,
                oldEnd: oldLine, newEnd: newLine, lines: [] };
            blocks.push(block);
        }
        block.lines.push(line);
        if (line.type !== "add") oldLine++;
        if (line.type !== "del") newLine++;
        block.oldEnd = oldLine; block.newEnd = newLine;
    }
    for (const block of blocks) {
        if (block.type === "context") continue;
        if (block.oldStart === block.oldEnd) block.type = "add";
        else if (block.newStart === block.newEnd) block.type = "del";
    }
    return blocks;
}

/** Map visual block boundaries; surplus lines stay at the shorter side's end. */
export function transferScroll(position, anchors) {
    if (!anchors.length) return position;
    let previous = anchors[0];
    for (let i = 1; i < anchors.length; i++) {
        const next = anchors[i];
        if (position <= next[0]) {
            if (position === previous[0]) return previous[1];
            if (position === next[0]) return next[1];
            return Math.min(previous[1] + position - previous[0], next[1]);
        }
        previous = next;
    }
    return previous[1] + position - previous[0];
}

/** Keep corresponding visual lines near one third of the active viewport. */
export function synchronizedScroll(position, viewportHeight, targetPosition, lineHeight, anchors) {
    const reference = Math.floor(viewportHeight / 3);
    const offset = position + reference;
    const visualTop = Math.floor(offset / lineHeight) * lineHeight;
    const mapped = transferScroll(visualTop, anchors);
    const correction = offset - visualTop;
    const destination = mapped - reference + correction;
    // Several source lines can map to one target boundary. Do not let their
    // fractional offsets repeatedly move the waiting side forward and backward.
    const repeatsBefore = visualTop > 0 && Math.abs(mapped - transferScroll(visualTop - lineHeight, anchors)) < 0.01;
    const repeatsAfter = Math.abs(mapped - transferScroll(visualTop + lineHeight, anchors)) < 0.01;
    const suppressBackward = correction < lineHeight / 2 && repeatsBefore && destination < targetPosition;
    const suppressForward = correction > lineHeight / 2 && repeatsAfter && destination > targetPosition;
    if ((suppressBackward || suppressForward) && Math.abs(destination - targetPosition) < lineHeight) return targetPosition;
    return destination;
}
