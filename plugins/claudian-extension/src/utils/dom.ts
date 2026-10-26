export function getWindow(doc: Document): (Window & typeof globalThis) | null {
    return doc.defaultView as (Window & typeof globalThis) | null;
}

export function eventElement(event: Event): Element | null {
    const target = event.target as Node | null;
    return target?.nodeType === 1 ? target as Element : target?.parentElement ?? null;
}
