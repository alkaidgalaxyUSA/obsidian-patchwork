/** Lease native nodes and restore only state still held by this owner. */
export class NativeControls {
    constructor() { this.entries = new Map(); }

    move(button, host, attributes = {}, icon) {
        let entry = this.entries.get(button);
        if (!entry) {
            const marker = button.ownerDocument.createComment("Patchwork native control position");
            button.before(marker);
            entry = { button, marker, host, attributes: new Map(), artwork: icon ? [...button.childNodes] : undefined };
            this.entries.set(button, entry);
            if (icon) { icon(button); entry.appliedArtwork = [...button.childNodes]; }
        }
        for (const [name, value] of Object.entries(attributes)) {
            if (!entry.attributes.has(name)) entry.attributes.set(name, { previous: button.getAttribute(name), applied: value });
            button.setAttribute(name, value);
        }
        if (button.parentElement !== host) host.append(button);
        return entry;
    }

    release(button) {
        const entry = this.entries.get(button);
        if (!entry) return;
        this.entries.delete(button);
        if (button.parentElement === entry.host && entry.marker.parentNode) entry.marker.replaceWith(button);
        else entry.marker.remove();
        if (entry.artwork && button.childNodes.length === entry.appliedArtwork.length
            && entry.appliedArtwork.every((node, index) => button.childNodes[index] === node)) button.replaceChildren(...entry.artwork);
        for (const [name, { previous, applied }] of entry.attributes) {
            if (button.getAttribute(name) !== applied) continue;
            if (previous === null) button.removeAttribute(name); else button.setAttribute(name, previous);
        }
    }

    dispose() { for (const button of this.entries.keys()) this.release(button); }
}
