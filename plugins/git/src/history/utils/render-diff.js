import { pairLines, wordDiff } from "./word-diff";

/** Render parsed changes with Patchwork's own diff classes and typography. */
export function renderDiff(output, raw, files, mode, contextMenu) {
    if (!files.length) { output.setText(raw || "No changes."); return; }
    for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
        const file = files[fileIndex];
        output.createSpan({ cls: "pw-diff-file", text: `${file.oldPath ? file.oldPath + " → " : ""}${file.path}  +${file.additions} −${file.deletions}\n` });
        if (file.binary) { output.createSpan({ text: "Binary file changed\n" }); continue; }
        if (!file.hunks.length) { output.createSpan({ text: file.oldPath ? "Renamed; content unchanged\n" : file.change === "modified" ? "File mode changed; content unchanged\n" : `${file.change === "added" ? "Added" : "Deleted"} empty file\n` }); continue; }
        for (let hunkIndex = 0; hunkIndex < file.hunks.length; hunkIndex++) {
            const hunk = file.hunks[hunkIndex];
            const block = output.createSpan({ cls: "pw-diff-hunk" });
            block.createSpan({ cls: "pw-diff-hunk-heading", text: `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@ ${hunk.header}\n` });
            if (mode === "split") renderSplit(block, hunk);
            else for (const line of hunk.lines) block.createSpan({ cls: `pw-diff-${line.type}`, text: `${line.type === "add" ? "+" : line.type === "del" ? "-" : " "}${line.content}\n` });
            block.addEventListener("contextmenu", event => contextMenu(event, file, fileIndex, hunkIndex));
        }
    }
}

function renderSplit(block, hunk) {
    for (const pair of pairLines(hunk.lines)) {
        const row = block.createSpan({ cls: "pw-diff-pair" });
        const left = row.createSpan({ cls: `pw-diff-cell pw-diff-${pair.left?.type || "context"}` });
        const right = row.createSpan({ cls: `pw-diff-cell pw-diff-${pair.right?.type || (pair.type === "context" ? "context" : "empty")}` });
        const words = pair.type === "modify" ? wordDiff(pair.left.content, pair.right.content) : undefined;
        renderCell(left, pair.left, words?.old, pair.left?.oldLineNo);
        const rightLine = pair.right || (pair.type === "context" ? pair.left : undefined);
        renderCell(right, rightLine, words?.new, rightLine?.newLineNo);
    }
}

function renderCell(cell, line, segments, number) {
    if (!line) return;
    cell.createSpan({ cls: "pw-diff-line-number", text: String(number ?? "") });
    if (segments) for (const segment of segments) cell.createSpan({ cls: segment.changed ? "pw-diff-word" : "", text: segment.value });
    else cell.createSpan({ text: line.content });
}
