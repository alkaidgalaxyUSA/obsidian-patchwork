import type { WindowContext } from "../contracts/common";

interface WindowHost {
    contexts: WeakMap<Document, WindowContext>;
    documents: Map<string, WeakRef<Document>>;
    retired: WeakSet<Document>;
    nextId: number;
}

const hostKey = Symbol.for("patchwork.windows.v1");

function getHost(): WindowHost {
    const existing = Reflect.get(globalThis, hostKey) as WindowHost | undefined;
    if (existing) return existing;
    const host: WindowHost = { contexts: new WeakMap(), documents: new Map(), retired: new WeakSet(), nextId: 0 };
    Object.defineProperty(globalThis, hostKey, { value: host });
    return host;
}

/** Stable across bundles, with no strong global reference to a closed document. */
export function getWindowContext(document: Document): WindowContext {
    const host = getHost();
    const win = document.defaultView;
    if (!win || win.closed || host.retired.has(document)) throw new Error("The requested workspace window is closed.");
    const existing = host.contexts.get(document);
    if (existing) return existing;
    const context = Object.freeze({ windowId: `patchwork-window-${++host.nextId}`, document });
    host.contexts.set(document, context);
    host.documents.set(context.windowId, new WeakRef(document));
    win.addEventListener("unload", () => {
        host.retired.add(document);
        host.documents.delete(context.windowId);
    }, { once: true });
    // Remove dead weak entries when another live window is registered.
    for (const [id, reference] of host.documents) {
        if (!reference.deref()) host.documents.delete(id);
    }
    return context;
}

export function resolveWindow(windowId: string): WindowContext | undefined {
    const host = getHost();
    const document = host.documents.get(windowId)?.deref();
    if (!document?.defaultView || document.defaultView.closed) {
        host.documents.delete(windowId);
        return undefined;
    }
    return host.contexts.get(document);
}
