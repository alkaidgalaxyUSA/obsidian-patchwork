import { readOnlyCaret } from "./read-only-caret";
import { overlayScrollbar } from "./overlay-scrollbar";

/** Isolated text viewports keep gutters outside horizontal scrolling. */
export function splitDocuments(output, blocks, registerCleanup) {
    if (!blocks.length || !blocks[0].querySelector(".pw-diff-pair")) return;
    const documents = output.createDiv({ cls: "pw-diff-documents" });
    blocks[0].before(documents);
    const left = documents.createDiv({ cls: "pw-diff-document pw-diff-document-left" });
    const leftNumbers = documents.createDiv({ cls: "pw-diff-numbers pw-diff-numbers-left" });
    documents.createDiv({ cls: "pw-diff-center-space" });
    const rightNumbers = documents.createDiv({ cls: "pw-diff-numbers pw-diff-numbers-right" });
    const right = documents.createDiv({ cls: "pw-diff-document pw-diff-document-right" });
    const leftTrack = leftNumbers.createDiv();
    const rightTrack = rightNumbers.createDiv();
    let number = 0;
    for (const block of blocks) {
        const peer = right.createDiv({ cls: "pw-diff-hunk-peer" });
        for (const row of [...block.querySelectorAll(".pw-diff-pair")]) {
            const a = row.firstElementChild, b = row.lastElementChild;
            a.querySelector(".pw-diff-line-number")?.remove();
            b.querySelector(".pw-diff-line-number")?.remove();
            block.append(a); peer.append(b); row.remove();
            number++;
            leftTrack.createDiv({ text: String(number) });
            rightTrack.createDiv({ text: String(number) });
        }
        left.append(block);
    }
    readOnlyCaret(left, documents, registerCleanup);
    readOnlyCaret(right, documents, registerCleanup);
    overlayScrollbar(right, documents, registerCleanup);
    overlayScrollbar(left, documents, registerCleanup);
    overlayScrollbar(left, documents, registerCleanup, "horizontal");
    overlayScrollbar(right, documents, registerCleanup, "horizontal");
    let syncing = false;
    let frame;
    const win = output.ownerDocument.defaultView;
    const max = element => element.scrollWidth - element.clientWidth;
    const logicalX = element => element === left ? max(left) + left.scrollLeft : element.scrollLeft;
    const setX = (element, value) => { element.scrollLeft = element === left ? value - max(left) : value; };
    const updateNumbers = () => {
        leftNumbers.scrollTop = left.scrollTop;
        rightNumbers.scrollTop = right.scrollTop;
    };
    const sync = (source, target) => {
        updateNumbers();
        if (syncing) return;
        syncing = true;
        target.scrollTop = source.scrollTop;
        const ratio = max(source) > 0 ? logicalX(source) / max(source) : 0;
        setX(target, ratio * max(target));
        updateNumbers();
        frame = win.requestAnimationFrame(() => { syncing = false; frame = undefined; });
    };
    const syncLeft = () => sync(left, right), syncRight = () => sync(right, left);
    left.addEventListener("scroll", syncLeft, { passive: true });
    right.addEventListener("scroll", syncRight, { passive: true });
    const observer = new win.ResizeObserver(() => {
        if (!left.dataset.initialized && left.clientWidth) {
            left.dataset.initialized = "true";
            setX(left, 0);
        }
        updateNumbers();
    });
    observer.observe(left);
    registerCleanup(() => {
        observer.disconnect();
        if (frame !== undefined) win.cancelAnimationFrame(frame);
        left.removeEventListener("scroll", syncLeft);
        right.removeEventListener("scroll", syncRight);
    });
}
