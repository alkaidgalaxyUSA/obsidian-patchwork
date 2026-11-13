/** Compare document text without confusing newline normalization with byte equality. */
export function equalDiffContent(path, before, after) {
    const left = decode(before), right = decode(after);
    if (!left || !right || left.text !== right.text) return;
    const encodingChanged = left.encoding !== right.encoding || left.bom !== right.bom;
    const separatorsChanged = left.separators !== right.separators;
    const difference = encodingChanged && separatorsChanged ? "charset and line separators"
        : encodingChanged ? "charset" : separatorsChanged ? "line separators" : undefined;
    const notification = difference ? `Contents have differences only in ${difference}` : "Contents are identical";
    const lines = left.text.split("\n").map((content, index) => ({ type: "context", content, oldLineNo: index + 1, newLineNo: index + 1 }));
    return { notification, files: [{ path, change: "modified", binary: false, additions: 0, deletions: 0,
        hunks: [{ oldStart: 1, oldLines: lines.length, newStart: 1, newLines: lines.length, header: "", lines }] }] };
}

function decode(bytes) {
    let encoding = "utf-8", bom = false;
    if (bytes[0] === 0xff && bytes[1] === 0xfe) { encoding = "utf-16le"; bom = true; }
    else if (bytes[0] === 0xfe && bytes[1] === 0xff) { encoding = "utf-16be"; bom = true; }
    else bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
    try {
        const raw = new TextDecoder(encoding, { fatal: true }).decode(bytes);
        if (raw.includes("\0")) return;
        // Retain the ordered separator sequence, including mixed line endings.
        const separators = JSON.stringify(raw.match(/\r\n|\r|\n/g) ?? []);
        return { text: raw.replace(/\r\n|\r/g, "\n"), encoding, bom, separators };
    } catch { return; }
}
