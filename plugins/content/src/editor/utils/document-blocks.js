import { scanCodeBlocks } from "./note-code-block.js";

// Keep fenced blocks, tables and contiguous quote lines together during a move.
function documentBlocks(doc) {
    const fences = new Map(scanCodeBlocks(doc).map((block) => [block.startLine, block]));
    const blocks = [];
    let number = 1;
    if (doc.line(1).text === "---") {
        number++;
        while (number <= doc.lines && !/^(---|\.\.\.)\s*$/.test(doc.line(number).text)) number++;
        number++;
    }
    while (number <= doc.lines) {
        const line = doc.line(number);
        if (!line.text.trim()) { number++; continue; }
        const fence = fences.get(number);
        if (fence) {
            blocks.push({ from: fence.from, to: fence.to, type: "code", contentFrom: fence.contentFrom });
            number = fence.endLine + 1;
            continue;
        }
        const from = line.from;
        number++;
        const table = /^\s*\|/.test(line.text) || number <= doc.lines && /^\s*\|?\s*:?-{3,}/.test(doc.line(number).text);
        const quote = /^\s*>/.test(line.text);
        const callout = /^\s*>\s*\[!/.test(line.text);
        if (table || quote) {
            while (number <= doc.lines && doc.line(number).text.trim() && !fences.has(number)
                && (quote ? /^\s*>/.test(doc.line(number).text) : /\|/.test(doc.line(number).text))) number++;
        }
        const heading = line.text.match(/^#{1,6}(?=\s)/)?.[0].length;
        const type = heading ? `heading-${heading}` : quote ? "quote"
            : /^\s*[-+*]\s+\[[ xX]\]/.test(line.text) ? "todo-list"
            : /^\s*\d+[.)]\s/.test(line.text) ? "numbered-list"
            : /^\s*[-+*]\s/.test(line.text) ? "bulleted-list" : "text";
        // Independent editor paragraphs get independent handles; complex blocks stay intact.
        blocks.push({ from, to: doc.line(number - 1).to, contentFrom: from, type, complex: table || callout });
    }
    return blocks;
}

function moveCodeBlock(view, block, destination) {
    const doc = view.state.doc;
    const end = Math.min(doc.length, block.to + 1);
    if (view.state.readOnly || destination >= block.from && destination <= end) return false;
    const precedingNewlines = doc.sliceString(Math.max(0, destination - 2), destination).match(/\n*$/)[0].length;
    const prefix = destination > 0 ? "\n".repeat(2 - precedingNewlines) : "";
    const insert = prefix + doc.sliceString(block.from, block.to) + "\n\n";
    const anchor = destination - (destination > block.from ? end - block.from : 0) + prefix.length + (block.contentFrom ?? block.from) - block.from;
    view.dispatch({ changes: [{ from: block.from, to: end }, { from: destination, insert }].sort((a, b) => a.from - b.from),
        selection: { anchor }, scrollIntoView: true, userEvent: "move.code-block" });
    view.focus();
    return true;
}

export { documentBlocks, moveCodeBlock };
