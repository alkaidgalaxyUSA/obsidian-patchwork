/** Difference navigation always positions both documents, even with sync disabled. */
export function navigateDifference(host, previous, step) {
    const changes = [...host.querySelectorAll("[data-diff-change]")];
    if (!changes.length) return;
    const index = previous === undefined ? (step > 0 ? 0 : changes.length - 1)
        : (previous + step + changes.length) % changes.length;
    const target = changes[index];
    target.scrollIntoView({ block: "center" });
    target.focus({ preventScroll: true });
    const peer = [...host.querySelectorAll(".pw-diff-document-right [data-block-id]")]
        .find(element => element.dataset.blockId === target.dataset.diffChange);
    if (peer) {
        const viewport = peer.closest(".pw-diff-document");
        viewport.scrollTop += peer.getBoundingClientRect().top - viewport.getBoundingClientRect().top
            - Math.max(0, (viewport.clientHeight - peer.getBoundingClientRect().height) / 2);
    }
    const documents = target.closest(".pw-diff-documents");
    if (documents) documents.dispatchEvent(new host.ownerDocument.defaultView.Event("pw-diff-positioned"));
    return { index, fileIndex: Number(target.dataset.diffChange.split(":")[0]) };
}
