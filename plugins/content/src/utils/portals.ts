import { Menu as NativeMenu, Modal as NativeModal, FuzzySuggestModal as NativeFuzzySuggestModal } from "obsidian";
import type { App, MenuItem } from "obsidian";
import { scopeModule, type ModuleScope } from "../../../utils/module-scope";

const ownedDom = new WeakMap<HTMLElement, { closeOwned(): void; refreshOwned(): void }>();
const portals = new Set<{ closeOwned(): void; refreshOwned(): void }>();
function source(root: HTMLElement): HTMLElement | undefined {
    const active = root.ownerDocument.activeElement?.closest<HTMLElement>('[data-pw-module="content"]');
    if (active && active !== root && !root.contains(active)) return active;
    return Array.from(root.ownerDocument.querySelectorAll<HTMLElement>(
        '.workspace-leaf-content[data-pw-module="content"], [data-pw-surface="settings"][data-pw-module="content"]'))
        .find(candidate => candidate !== root && !root.contains(candidate));
}

class ScopedContentMenu extends NativeMenu {
    declare dom: HTMLElement;
    private moduleScope?: ModuleScope;
    constructor() { super(); this.onHide(() => { this.moduleScope?.dispose(); this.moduleScope = undefined; portals.delete(this); }); }
    refreshOwned(): void { const host = source(this.dom); if (host) this.moduleScope?.refreshTokens(host); }
    addItem(callback: (item: MenuItem) => unknown): this {
        super.addItem(item => {
            const native = item as MenuItem & { setSubmenu?: () => NativeMenu };
            const original = native.setSubmenu;
            if (original) native.setSubmenu = () => {
                const menu = original.call(item) as NativeMenu & { dom: HTMLElement };
                const scope = scopeModule(menu.dom, "content", { surface: "submenu" });
                scope.refreshTokens(source(this.dom) ?? this.dom);
                const portal = { closeOwned: () => menu.hide(), refreshOwned: () => scope.refreshTokens(source(this.dom) ?? this.dom) };
                portals.add(portal);
                menu.onHide(() => { scope.dispose(); portals.delete(portal); });
                this.onHide(() => menu.hide());
                return menu;
            };
            callback(item);
        });
        return this;
    }
    private own(): void { this.moduleScope ??= scopeModule(this.dom, "content", { surface: "menu" }); portals.add(this); this.refreshOwned(); }
    showAtPosition(...args: Parameters<NativeMenu["showAtPosition"]>): this { this.own(); super.showAtPosition(...args); this.refreshOwned(); return this; }
    showAtMouseEvent(...args: Parameters<NativeMenu["showAtMouseEvent"]>): this { this.own(); super.showAtMouseEvent(...args); this.refreshOwned(); return this; }
    closeOwned(): void { this.hide(); }
}

export class ContentModal extends NativeModal {
    private moduleScope?: ModuleScope;
    constructor(app: App) { super(app); }
    refreshOwned(): void { const host = source(this.modalEl); if (host) this.moduleScope?.refreshTokens(host); }
    open(): void { this.moduleScope ??= scopeModule(this.modalEl, "content", { surface: "dialog" }); portals.add(this); this.refreshOwned(); super.open(); }
    close(): void { try { super.close(); } finally { this.moduleScope?.dispose(); this.moduleScope = undefined; portals.delete(this); } }
    closeOwned(): void { this.close(); }
}

export abstract class ContentFuzzySuggestModal<T> extends NativeFuzzySuggestModal<T> {
    private moduleScope?: ModuleScope;
    refreshOwned(): void { const host = source(this.modalEl); if (host) this.moduleScope?.refreshTokens(host); }
    open(): void { this.moduleScope ??= scopeModule(this.modalEl, "content", { surface: "suggestion" }); portals.add(this); this.refreshOwned(); super.open(); }
    close(): void { try { super.close(); } finally { this.moduleScope?.dispose(); this.moduleScope = undefined; portals.delete(this); } }
    closeOwned(): void { this.close(); }
}

export function refreshContentPortals(): void { for (const portal of portals) portal.refreshOwned(); }
export function closeContentPortals(): void { for (const portal of [...portals]) portal.closeOwned(); portals.clear(); }

export const ContentMenu = ScopedContentMenu;
export type ContentMenu = NativeMenu;

/** Creator-managed DOM portals; no document-wide ownership observer. */
export function ownContentPortal(root: HTMLElement, removable = true, origin?: HTMLElement): void {
    if (ownedDom.has(root)) return;
    const host = () => origin?.isConnected ? origin : source(root);
    const scope = scopeModule(root, "content", { surface: "popover" });
    const portal = {
        closeOwned: () => { if (removable) root.remove(); scope.dispose(); portals.delete(portal); ownedDom.delete(root); },
        refreshOwned: () => {
            if (!root.isConnected || root.ownerDocument.defaultView?.closed) { scope.dispose(); portals.delete(portal); ownedDom.delete(root); return; }
            const target = host(); if (target && target !== root) scope.refreshTokens(target);
        },
    };
    portals.add(portal); ownedDom.set(root, portal);
    const target = host(); if (target && target !== root) scope.refreshTokens(target);
}
