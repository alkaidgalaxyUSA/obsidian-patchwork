import { highlightSegments } from "./highlight-line";
import { pairLines, wordDiff } from "./word-diff";
import { setIcon } from "../../utils/icons";
import { splitDocuments } from "./split-documents";
import { diffBlocks } from "./diff-blocks";
import { singleDocument } from "./single-document";

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
        const single = !!options.registerCleanup && ["added", "deleted"].includes(file.change);
        const fileLabel = file.oldPath ? `${file.oldPath} → ${file.path}` : file.path;
        const header = output.createSpan({ cls: "pw-diff-file" });
        header.dataset.fileIndex = String(fileIndex);
        if (options.historical || options.comparisonLabels) {
            header.classList.add("pw-diff-revision-headers");
            const revisionHeader = (revision, path, label) => {
                const side = header.createSpan({ cls: "pw-diff-revision-header" });
                setIcon(side.createSpan({ cls: "pw-diff-file-lock", attr: { "aria-hidden": "true" } }), "status-file-lock");
                side.createSpan({ cls: "pw-diff-file-revision", text: label ?? (revision?.slice(0, 8) || "--------") });
                if (path) side.createSpan({ cls: "pw-diff-file-path", text: path });
            };
            if (!single || file.change === "deleted") revisionHeader(file.change === "added" ? "Absent" : options.baseRevisions?.[fileIndex], file.oldPath || file.path, file.change === "added" ? undefined : options.comparisonLabels?.left);
            if (!single || file.change === "added") revisionHeader(file.change === "deleted" ? "Absent" : options.revision, file.path, file.change === "deleted" ? undefined : options.comparisonLabels?.right);
        } else header.setText(`${fileLabel}  +${file.additions} −${file.deletions}\n`);
        if (file.binary) { output.createSpan({ text: "Binary file changed\n" }); continue; }
        if (!file.hunks.length) { output.createSpan({ text: file.oldPath ? "Renamed; content unchanged\n" : file.change === "modified" ? "File mode changed; content unchanged\n" : `${file.change === "added" ? "Added" : "Deleted"} empty file\n` }); continue; }
        const blocks = [];
        const finish = () => {
            const settings = { ...options, position: options.positions?.[fileIndex] };
            if (single) singleDocument(output, blocks, registerCleanup, { ...settings, deleted: file.change === "deleted" });
            else if (options.registerCleanup && mode === "split") splitDocuments(output, blocks, registerCleanup, settings);
        };
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
            if (mode !== "split" && !single) block.createSpan({ cls: "pw-diff-hunk-heading", text: `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@ ${hunk.header}\n` });
            if (mode === "split" || single) renderSplit(block, hunk, file.path, fileIndex, hunkIndex, options, wordsFor);
            else {
                const segments = new Map();
                for (const change of diffBlocks(hunk, fileIndex, hunkIndex)) {
                    for (const { pair, words } of changePresentation(change, wordsFor).rows) {
                        if (words?.old) segments.set(pair.left, words.old);
                        if (words?.new) segments.set(pair.right, words.new);
                    }
                }
                const changes = new Map(diffBlocks(hunk, fileIndex, hunkIndex).filter(change => change.type !== "context").map(change => [change.lines[0], change]));
                for (const line of hunk.lines) {
                const span = block.createSpan({ cls: `pw-diff-unified-line pw-diff-${line.type}` });
                if (segments.has(line)) span.classList.add("pw-diff-inner");
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
        const presentation = changePresentation(change, wordsFor);
        for (const { pair, words } of presentation.rows) {
            const row = group.createDiv({ cls: "pw-diff-pair" });
            const rightLine = pair.right || (pair.type === "context" ? pair.left : undefined);
            const left = row.createSpan({ cls: `pw-diff-cell pw-diff-left pw-diff-${change.type}` });
            const right = row.createSpan({ cls: `pw-diff-cell pw-diff-${change.type}` });
            if (presentation.inner) { left.classList.add("pw-diff-inner"); right.classList.add("pw-diff-inner"); }
            renderCell(left, pair.left, words?.old, pair.left?.oldLineNo, path, options);
            renderCell(right, rightLine, words?.new, rightLine?.newLineNo, path, options);
            if (rightLine?.newLineNo) { right.dataset.path = path; right.dataset.newLine = String(rightLine.newLineNo); }
        }
    }
}

/** Inner fragments weaken the whole change in the editor, never its gutter or connector. */
function changePresentation(change, wordsFor) {
    const rows = pairLines(change.lines).map(pair => ({ pair,
        words: pair.type === "modify" ? wordsFor(pair.left.content, pair.right.content) : undefined,
    }));
    const inner = change.type === "modify" && rows.some(row => row.words);
    if (inner) for (const row of rows) {
        if (row.words) continue;
        const { pair } = row;
        const segment = line => line ? [{ value: line.content, changed: true, type: pair.type }] : undefined;
        row.words = { old: segment(pair.left), new: segment(pair.right) };
    }
    return { rows, inner };
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
