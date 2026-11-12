import { highlightSegments } from "./highlight-line";
import { pairLines, wordDiff } from "./word-diff";
import { setIcon } from "../../utils/icons";
import { splitDocuments } from "./split-documents";

/** Render parsed changes with Patchwork's own diff classes and typography. */
export function renderDiff(output, raw, files, mode, contextMenu, limit = 3000, options = {}) {
    if (!files.length) { output.setText(raw || "No changes."); return; }
    let count = 0;
    const more = () => { const button = output.createEl("button", { text: "Show more diff lines", attr: { type: "button" } }); button.onclick = () => { output.empty(); renderDiff(output, raw, files, mode, contextMenu, limit + 3000, options); }; };
    for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
        if (count >= limit) { more(); return; }
        const file = files[fileIndex];
        const fileLabel = file.oldPath ? `${file.oldPath} → ${file.path}` : file.path;
        const header = output.createSpan({ cls: "pw-diff-file" });
        if (options.historical) {
            header.classList.add("pw-diff-revision-headers");
            const revisionHeader = (revision, path) => {
                const side = header.createSpan({ cls: "pw-diff-revision-header" });
                setIcon(side.createSpan({ cls: "pw-diff-file-lock", attr: { "aria-hidden": "true" } }), "status-file-lock");
                side.createSpan({ cls: "pw-diff-file-revision", text: revision?.slice(0, 8) || "--------" });
                if (path) side.createSpan({ cls: "pw-diff-file-path", text: path });
            };
            if (file.change !== "added") revisionHeader(options.baseRevisions?.[fileIndex], file.oldPath || file.path);
            if (file.change !== "deleted") revisionHeader(options.revision, file.change === "added" ? file.path : undefined);
        } else header.setText(`${fileLabel}  +${file.additions} −${file.deletions}\n`);
        if (file.binary) { output.createSpan({ text: "Binary file changed\n" }); continue; }
        if (!file.hunks.length) { output.createSpan({ text: file.oldPath ? "Renamed; content unchanged\n" : file.change === "modified" ? "File mode changed; content unchanged\n" : `${file.change === "added" ? "Added" : "Deleted"} empty file\n` }); continue; }
        const singleSide = mode === "split" && (file.change === "added" || file.change === "deleted");
        const blocks = [];
        const finish = () => { if (options.registerCleanup && mode === "split" && !singleSide) splitDocuments(output, blocks, options.registerCleanup); };
        for (let hunkIndex = 0; hunkIndex < file.hunks.length; hunkIndex++) {
            if (count >= limit) { finish(); more(); return; }
            const original = file.hunks[hunkIndex];
            const truncated = original.lines.length > limit - count;
            const hunk = truncated ? { ...original, lines: original.lines.slice(0, limit - count) } : original;
            count += hunk.lines.length;
            const block = output.createSpan({ cls: "pw-diff-hunk", attr: { tabindex: "0" } });
            blocks.push(block);
            if (!options.historical) block.createSpan({ cls: "pw-diff-hunk-heading", text: `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@ ${hunk.header}\n` });
            if (mode === "split") renderSplit(block, hunk, file.path, singleSide, file.change);
            else {
                const segments = new Map();
                for (const pair of pairLines(hunk.lines)) {
                    if (pair.type !== "modify" || pair.left.content.length > 2000 || pair.right.content.length > 2000) continue;
                    const words = wordDiff(pair.left.content, pair.right.content);
                    if (words) { segments.set(pair.left, words.old); segments.set(pair.right, words.new); }
                }
                for (const line of hunk.lines) {
                const span = block.createSpan({ cls: `pw-diff-unified-line pw-diff-${line.type}` });
                if (line.newLineNo) { span.dataset.path = file.path; span.dataset.newLine = String(line.newLineNo); }
                span.createSpan({ cls: "pw-diff-line-number", text: String(line.oldLineNo ?? "") });
                span.createSpan({ cls: "pw-diff-line-number", text: String(line.newLineNo ?? "") });
                span.createSpan({ cls: "pw-diff-line-sign", text: line.type === "add" ? "+" : line.type === "del" ? "-" : " " });
                highlightSegments(span.createSpan({ cls: "pw-diff-line-code" }), line.content, file.path, segments.get(line));
                }
            }
            if (!truncated && contextMenu) {
                block.addEventListener("contextmenu", event => contextMenu(event, file, fileIndex, hunkIndex));
                block.addEventListener("keydown", event => {
                    if (event.key !== "F10" || !event.shiftKey) return;
                    event.preventDefault(); const rect = block.getBoundingClientRect();
                    contextMenu(new block.ownerDocument.defaultView.MouseEvent("contextmenu", { clientX: rect.left, clientY: rect.top }), file, fileIndex, hunkIndex);
                });
            }
            if (truncated) { finish(); more(); return; }
        }
        finish();
    }
}

function renderSplit(block, hunk, path, singleSide = false, change) {
    for (const pair of pairLines(hunk.lines)) {
        if (singleSide) {
            const line = change === "deleted" ? pair.left : pair.right;
            const cell = block.createSpan({ cls: `pw-diff-cell pw-diff-${line?.type || "empty"} pw-diff-single` });
            renderCell(cell, line, undefined, change === "deleted" ? line?.oldLineNo : line?.newLineNo, path);
            continue;
        }
        const row = block.createSpan({ cls: "pw-diff-pair" });
        const left = row.createSpan({ cls: `pw-diff-cell pw-diff-left pw-diff-${pair.left?.type || "context"}` });
        const right = row.createSpan({ cls: `pw-diff-cell pw-diff-${pair.right?.type || (pair.type === "context" ? "context" : "empty")}` });
        const words = pair.type === "modify" && pair.left.content.length <= 2000 && pair.right.content.length <= 2000 ? wordDiff(pair.left.content, pair.right.content) : undefined;
        renderCell(left, pair.left, words?.old, pair.left?.oldLineNo, path);
        const rightLine = pair.right || (pair.type === "context" ? pair.left : undefined);
        if (rightLine?.newLineNo) { right.dataset.path = path; right.dataset.newLine = String(rightLine.newLineNo); }
        renderCell(right, rightLine, words?.new, rightLine?.newLineNo, path);
    }
}

function renderCell(cell, line, segments, number, path) {
    if (!line) return;
    cell.createSpan({ cls: "pw-diff-line-number", text: String(number ?? "") });
    highlightSegments(cell.createSpan({ cls: "pw-diff-cell-content" }), line.content, path, segments);
}
