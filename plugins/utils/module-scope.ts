import type { Disposable, Edge, ModuleId } from "../contracts/common";

interface AttributeLease {
    name: string;
    previous: string | null;
    applied: string;
}

interface PropertyLease {
    previous: string;
    priority: string;
    applied: string;
}

export interface ModuleScope extends Disposable {
    /** Refresh only the owning module's resolved tokens on a detached portal. */
    refreshTokens(source: HTMLElement): void;
}

export interface ModuleScopeOptions {
    border?: Edge;
    surface?: string;
    contribution?: boolean;
}

/** Own only granted roots and local portals; never tag the global body. */
export function scopeModule(root: HTMLElement, owner: ModuleId,
    options: ModuleScopeOptions = {}): ModuleScope {
    if (root === root.ownerDocument.body || root === root.ownerDocument.documentElement) {
        throw new Error("Patchwork module scope requires a local root.");
    }
    if (options.border && owner !== "borders") throw new Error("Only Borders can own an edge.");
    const attributes: AttributeLease[] = [];
    const properties = new Map<string, PropertyLease>();
    let disposed = false;
    const tag = (name: string, value: string) => {
        attributes.push({ name, previous: root.getAttribute(name), applied: value });
        root.setAttribute(name, value);
    };
    tag("data-pw-module", owner);
    if (options.contribution) tag("data-pw-owner", owner);
    if (options.surface) tag("data-pw-surface", options.surface);
    if (options.border) {
        tag("data-pw-border", options.border);
    }
    const restore = (name: string, lease: PropertyLease) => {
        if (root.style.getPropertyValue(name) !== lease.applied
            || root.style.getPropertyPriority(name) !== "") return;
        if (lease.previous) root.style.setProperty(name, lease.previous, lease.priority);
        else root.style.removeProperty(name);
    };
    return {
        refreshTokens(source) {
            if (disposed) return;
            const style = source.ownerDocument.defaultView?.getComputedStyle(source);
            if (!style) return;
            const names = new Set(Array.from(style).filter(name =>
                name.startsWith(`--pw-${owner}-`) || name.startsWith("--pw-icon-")));
            for (const [name, lease] of properties) {
                if (names.has(name)) continue;
                restore(name, lease);
                properties.delete(name);
            }
            for (const name of names) {
                const value = style.getPropertyValue(name).trim();
                const lease = properties.get(name) ?? {
                    previous: root.style.getPropertyValue(name),
                    priority: root.style.getPropertyPriority(name),
                    applied: value,
                };
                lease.applied = value;
                properties.set(name, lease);
                root.style.setProperty(name, value);
            }
        },
        dispose() {
            if (disposed) return;
            disposed = true;
            for (const [name, lease] of properties) restore(name, lease);
            properties.clear();
            for (const lease of attributes.reverse()) {
                if (root.getAttribute(lease.name) !== lease.applied) continue;
                if (lease.previous === null) root.removeAttribute(lease.name);
                else root.setAttribute(lease.name, lease.previous);
            }
        },
    };
}
