/** Keep a native menu near its anchor while respecting the invoking viewport. */
export function useAdaptiveMenuPosition(menu, owner = menu) {
    const original = menu.showAtPosition;
    let anchor;
    const reposition = () => {
        const { dom } = menu;
        if (!anchor || !dom.isConnected || dom.ownerDocument !== anchor.document) return;
        const viewport = dom.ownerDocument.documentElement.clientHeight;
        const margin = 8;
        const top = Math.max(margin, Math.min(anchor.y + 2, viewport - dom.offsetHeight - margin));
        dom.style.top = `${top}px`;
    };
    const show = function(position, doc) {
        const result = original.call(this, position, doc);
        anchor = { y: position.y, document: doc ?? this.dom.ownerDocument };
        reposition();
        return result;
    };
    menu.showAtPosition = show;
    owner.onHide(() => {
        if (menu.showAtPosition === show) menu.showAtPosition = original;
        anchor = undefined;
    });
    return reposition;
}
