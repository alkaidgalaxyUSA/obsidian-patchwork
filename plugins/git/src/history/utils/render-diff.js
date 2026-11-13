import { highlightSegments } from "./highlight-line";
import { pairLines, wordDiff } from "./word-diff";
import { setIcon } from "../../utils/icons";
import { splitDocuments } from "./split-documents";
import { diffBlocks } from "./diff-blocks";

/** Render parsed changes with Patchwork's own diff classes and typography. */
export function renderDiff(output, raw, files, mode, contextMenu, limit = 3000, options = {}) {
    let cleanups = [];
    const dispose = () => { for (const cleanup of cleanups.splice(0)) cleanup(); };
    options.registerCleanup?.(dispose);
    const registerCleanup = cleanup => cleanups.push(cleanup);
    output.classList.add("pw-diff-output");
    output.classList.toggle("pw-diff-wrap", !!options.wrap);
    if (!files.length) { output.setText(raw || "No changes."); return; }
    let count = 0;
    const deadline = Date.now() + 80;
    const wordsFor = (left, right) => Date.now() > deadline || left.length > 2000 || right.length > 2000 ? null : wordDiff(left, right);
    const more = () => { const button = output.createEl("button", { text: "Show more diff lines", attr: { type: "button" } }); button.onclick = () => { dispose(); output.empty(); renderDiff(output, raw, files, mode, contextMenu, limit + 3000, options); }; };
    for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
        if (count >= limit) { more(); return; }
        const file = files[fileIndex];
        const fileLabel = file.oldPath ? `${file.oldPath} → ${file.path}` : file.path;
        const header = output.createSpan({ cls: "pw-diff-file" });
        header.dataset.fileIndex = String(fileIndex);
        if (options.historical) {
            header.classList.add("pw-diff-revision-headers");
            const revisionHeader = (revision, path) => {
                const side = header.createSpan({ cls: "pw-diff-revision-header" });
                setIcon(side.createSpan({ cls: "pw-diff-file-lock", attr: { "aria-hidden": "true" } }), "status-file-lock");
                side.createSpan({ cls: "pw-diff-file-revision", text: revision?.slice(0, 8) || "--------" });
                if (path) side.createSpan({ cls: "pw-diff-file-path", text: path });
            };
            revisionHeader(file.change === "added" ? "Absent" : options.baseRevisions?.[fileIndex], file.oldPath || file.path);
            revisionHeader(file.change === "deleted" ? "Absent" : options.revision, file.path);
        } else header.setText(`${fileLabel}  +${file.additions} −${file.deletions}\n`);
        if (file.binary) { output.createSpan({ text: "Binary file changed\n" }); continue; }
        if (!file.hunks.length) { output.createSpan({ text: file.oldPath ? "Renamed; content unchanged\n" : file.change === "modified" ? "File mode changed; content unchanged\n" : `${file.change === "added" ? "Added" : "Deleted"} empty file\n` }); continue; }
        const blocks = [];
        const finish = () => { if (options.registerCleanup && mode === "split") splitDocuments(output, blocks, registerCleanup, { ...options, position: options.positions?.[fileIndex] }); };
        for (let hunkIndex = 0; hunkIndex < file.hunks.length; hunkIndex++) {
            if (count >= limit) { finish(); more(); return; }
            const rawHunk = file.hunks[hunkIndex];
            const original = options.collapse ? { ...rawHunk, lines: diffBlocks(rawHunk).flatMap(change => {
                const lines = change.lines;
                return change.type === "context" && lines.length > 8
                    ? [...lines.slice(0, 3), { type: "context", content: `⋯ ${lines.length - 6} unchanged lines ⋯`, folded: true }, ...lines.slice(-3)] : lines;
            }) } : rawHunk;
            const truncated = original.lines.length > limit - count;
            const hunk = truncated ? { ...original, lines: original.lines.slice(0, limit - count) } : original;
            count += hunk.lines.length;
            const block = output.createSpan({ cls: "pw-diff-hunk", attr: { tabindex: "0" } });
            blocks.push(block);
            if (mode !== "split") block.createSpan({ cls: "pw-diff-hunk-heading", text: `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@ ${hunk.header}\n` });
            if (mode === "split") renderSplit(block, hunk, file.path, fileIndex, hunkIndex, options, wordsFor);
            else {
                const segments = new Map();
                for (const pair of pairLines(hunk.lines)) {
                    if (pair.type !== "modify" || pair.left.content.length > 2000 || pair.right.content.length > 2000) continue;
                    const words = wordsFor(pair.left.content, pair.right.content);
                    if (words) { segments.set(pair.left, words.old); segments.set(pair.right, words.new); }
                }
                const changes = new Map(diffBlocks(hunk, fileIndex, hunkIndex).filter(change => change.type !== "context").map(change => [change.lines[0], change]));
                for (const line of hunk.lines) {
                const span = block.createSpan({ cls: `pw-diff-unified-line pw-diff-${line.type}` });
                const change = changes.get(line);
                if (change) { span.dataset.diffChange = change.id; span.tabIndex = 0; }
                if (line.newLineNo) { span.dataset.path = file.path; span.dataset.newLine = String(line.newLineNo); }
                span.createSpan({ cls: "pw-diff-line-number", text: String(line.oldLineNo ?? "") });
                span.createSpan({ cls: "pw-diff-line-number", text: String(line.newLineNo ?? "") });
                span.createSpan({ cls: "pw-diff-line-sign", text: line.type === "add" ? "+" : line.type === "del" ? "-" : " " });
                if (line.folded) { const button = span.createEl("button", { cls: "pw-diff-expand", text: line.content }); button.onclick = () => options.onExpandContext?.(); continue; }
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

function renderSplit(block, hunk, path, fileIndex, hunkIndex, options, wordsFor) {
    if (hunkIndex > 0) {
        const gap = block.createDiv({ cls: "pw-diff-block pw-diff-block-context" });
        gap.dataset.diffType = "context";
        const row = gap.createDiv({ cls: "pw-diff-pair" });
        for (let index = 0; index < 2; index++) {
            const cell = row.createDiv({ cls: "pw-diff-cell pw-diff-context" });
            renderCell(cell, { folded: true, content: "⋯ Unchanged lines omitted ⋯" }, undefined, undefined, path, options);
        }
    }
    for (const change of diffBlocks(hunk, fileIndex, hunkIndex)) {
        const group = block.createDiv({ cls: `pw-diff-block pw-diff-block-${change.type}` });
        group.dataset.blockId = change.id;
        group.dataset.diffType = change.type;
        group.dataset.oldStart = String(change.oldStart); group.dataset.oldEnd = String(change.oldEnd);
        group.dataset.newStart = String(change.newStart); group.dataset.newEnd = String(change.newEnd);
        if (change.type !== "context") { group.dataset.diffChange = change.id; group.tabIndex = 0; }
        for (const pair of pairLines(change.lines)) {
            const row = group.createDiv({ cls: "pw-diff-pair" });
            const rightLine = pair.right || (pair.type === "context" ? pair.left : undefined);
            const left = row.createSpan({ cls: `pw-diff-cell pw-diff-left pw-diff-${change.type}` });
            const right = row.createSpan({ cls: `pw-diff-cell pw-diff-${change.type}` });
            let words;
            if (pair.type === "modify" && pair.left.content.length <= 2000 && pair.right.content.length <= 2000) words = wordsFor(pair.left.content, pair.right.content);
            if (change.type === "modify" && pair.type === "add") words = { new: [{ value: pair.right.content, changed: true, type: "add" }] };
            if (change.type === "modify" && pair.type === "del") words = { old: [{ value: pair.left.content, changed: true, type: "del" }] };
            renderCell(left, pair.left, words?.old, pair.left?.oldLineNo, path, options);
            renderCell(right, rightLine, words?.new, rightLine?.newLineNo, path, options);
            if (rightLine?.newLineNo) { right.dataset.path = path; right.dataset.newLine = String(rightLine.newLineNo); }
        }
    }
}

function renderCell(cell, line, segments, number, path, options) {
    if (line?.folded) cell.classList.add("pw-diff-folded");
    cell.dataset.lineNumber = String(number ?? "");
    if (!line) { cell.classList.add("pw-diff-empty"); return; }
    if (line.folded) {
        const button = cell.createEl("button", { cls: "pw-diff-expand", text: line.content, attr: { type: "button", "aria-label": "Expand unchanged fragments" } });
        button.disabled = !options.onExpandContext;
        button.onclick = () => options.onExpandContext?.();
        return;
    }
    cell.createSpan({ cls: "pw-diff-line-number", text: String(number ?? "") });
    highlightSegments(cell.createSpan({ cls: "pw-diff-cell-content" }), line.content, path, segments);
}
