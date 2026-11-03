import { highlightLine } from "./highlight-line";
import { pairLines, wordDiff } from "./word-diff";

/** Render parsed changes with Patchwork's own diff classes and typography. */
export function renderDiff(output, raw, files, mode, contextMenu, limit = 3000) {
    if (!files.length) { output.setText(raw || "No changes."); return; }
    let count = 0;
    const more = () => { const button = output.createEl("button", { text: "Show more diff lines", attr: { type: "button" } }); button.onclick = () => { output.empty(); renderDiff(output, raw, files, mode, contextMenu, limit + 3000); }; };
    for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
        if (count >= limit) { more(); return; }
        const file = files[fileIndex];
        output.createSpan({ cls: "pw-diff-file", text: `${file.oldPath ? file.oldPath + " → " : ""}${file.path}  +${file.additions} −${file.deletions}\n` });
        if (file.binary) { output.createSpan({ text: "Binary file changed\n" }); continue; }
        if (!file.hunks.length) { output.createSpan({ text: file.oldPath ? "Renamed; content unchanged\n" : file.change === "modified" ? "File mode changed; content unchanged\n" : `${file.change === "added" ? "Added" : "Deleted"} empty file\n` }); continue; }
        if (mode === "split") {
            const columns = output.createSpan({ cls: "pw-diff-columns" });
            columns.createSpan({ text: "Before" }); columns.createSpan({ text: "After" });
        }
        for (let hunkIndex = 0; hunkIndex < file.hunks.length; hunkIndex++) {
            if (count >= limit) { more(); return; }
            const original = file.hunks[hunkIndex];
            const truncated = original.lines.length > limit - count;
            const hunk = truncated ? { ...original, lines: original.lines.slice(0, limit - count) } : original;
            count += hunk.lines.length;
            const block = output.createSpan({ cls: "pw-diff-hunk" });
            block.createSpan({ cls: "pw-diff-hunk-heading", text: `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@ ${hunk.header}\n` });
            if (mode === "split") renderSplit(block, hunk, file.path);
            else for (const line of hunk.lines) {
                const span = block.createSpan({ cls: `pw-diff-unified-line pw-diff-${line.type}` });
                span.createSpan({ cls: "pw-diff-line-number", text: String(line.oldLineNo ?? "") });
                span.createSpan({ cls: "pw-diff-line-number", text: String(line.newLineNo ?? "") });
                span.createSpan({ cls: "pw-diff-line-sign", text: line.type === "add" ? "+" : line.type === "del" ? "-" : " " });
                highlightLine(span.createSpan({ cls: "pw-diff-line-code" }), line.content, file.path);
            }
            if (!truncated && contextMenu) block.addEventListener("contextmenu", event => contextMenu(event, file, fileIndex, hunkIndex));
            if (truncated) { more(); return; }
        }
    }
}

function renderSplit(block, hunk, path) {
    for (const pair of pairLines(hunk.lines)) {
        const row = block.createSpan({ cls: "pw-diff-pair" });
        const left = row.createSpan({ cls: `pw-diff-cell pw-diff-${pair.left?.type || "context"}` });
        const right = row.createSpan({ cls: `pw-diff-cell pw-diff-${pair.right?.type || (pair.type === "context" ? "context" : "empty")}` });
        const words = pair.type === "modify" && pair.left.content.length <= 2000 && pair.right.content.length <= 2000 ? wordDiff(pair.left.content, pair.right.content) : undefined;
        renderCell(left, pair.left, words?.old, pair.left?.oldLineNo, path);
        const rightLine = pair.right || (pair.type === "context" ? pair.left : undefined);
        renderCell(right, rightLine, words?.new, rightLine?.newLineNo, path);
    }
}

function renderCell(cell, line, segments, number, path) {
    if (!line) return;
    cell.createSpan({ cls: "pw-diff-line-number", text: String(number ?? "") });
    if (segments) for (const segment of segments) cell.createSpan({ cls: segment.changed ? "pw-diff-word" : "", text: segment.value });
    else highlightLine(cell.createSpan(), line.content, path);
}
