import { setIcon } from "../../utils/icons";

import type { App } from "obsidian";
import type { ZenEntry } from "./types";
import { getWindow } from "./utils/dom";
const ROOT_CLASS = "claudian-extension-zen";
const COLLAPSED_CLASS = "claudian-extension-zen-collapsed";
const COMPOSER_CLASS = "claudian-extension-zen-composer";

export class ZenActions {
    private entries = new Map<HTMLElement, ZenEntry>();
    private disposed = false;

    constructor(private readonly app: App) {}

    sync() {
        if (this.disposed) return;
        const documents = new Set([this.app.workspace.containerEl.ownerDocument]);
        this.app.workspace.iterateAllLeaves((leaf) => documents.add(leaf.view.containerEl.ownerDocument));
        const current = new Set<HTMLElement>();
        for (const doc of documents) {
            for (const root of doc.querySelectorAll<HTMLElement>(".claudian-container.claudian-zen")) {
                const host = root.closest<HTMLElement>(".claudian-zen-host");
                const composer = root.querySelector<HTMLElement>(":scope > .claudian-zen-composer");
                const send = composer?.querySelector<HTMLElement>(".claudian-extension-send");
                if (!host || !composer || !send) continue;
                const previous = this.entries.get(root);
                if (previous && (previous.host !== host || previous.composer !== composer
                    || previous.send !== send || previous.collapse.parentElement !== composer)) {
                    this.detach(root);
                }
                const entry = this.entries.get(root) ?? this.attach(root, host, composer, send);
                current.add(root);
                this.position(entry);
            }
        }
        for (const root of this.entries.keys()) {
            if (!current.has(root)) this.detach(root);
        }
    }

    attach(root: HTMLElement, host: HTMLElement, composer: HTMLElement, send: HTMLElement): ZenEntry {
        const doc = root.ownerDocument;
        const collapse = doc.createElement("button");
        collapse.type = "button";
        collapse.className = "claudian-extension-zen-toggle";
        collapse.setAttribute("aria-label", "Collapse Zen mode to bottom");
        collapse.setAttribute("aria-expanded", "true");
        setIcon(collapse, "arrow-down");
        collapse.querySelector<HTMLElement>("svg")?.setAttribute("aria-hidden", "true");

        const dock = doc.createElement("div");
        dock.className = "claudian-extension-zen-dock";
        dock.hidden = true;
        const expand = doc.createElement("button");
        expand.type = "button";
        expand.className = "claudian-extension-zen-expand";
        expand.setAttribute("aria-label", "Expand Zen mode");
        expand.setAttribute("aria-expanded", "false");
        setIcon(expand, "code-header-toggle");
        expand.querySelector<HTMLElement>("svg")?.setAttribute("aria-hidden", "true");
        dock.append(expand);

        const onCollapse = (event: MouseEvent) => {
            event.preventDefault();
            event.stopPropagation();
            this.setCollapsed(entry, true);
            // Keyboard users retain a reachable control after the window is hidden.
            if (event.detail === 0) expand.focus({ preventScroll: true });
        };
        const onExpand = (event: MouseEvent) => {
            event.preventDefault();
            event.stopPropagation();
            this.setCollapsed(entry, false);
            composer.querySelector<HTMLElement>('.cm-content[contenteditable="true"]')?.focus({ preventScroll: true });
        };
        const onPointerDown = (event: PointerEvent) => event.stopPropagation();
        const entry: ZenEntry = { root, host, composer, send, collapse, dock, expand,
            originalInert: root.inert, onCollapse, onExpand, onPointerDown };
        collapse.addEventListener("click", entry.onCollapse);
        expand.addEventListener("click", entry.onExpand);
        collapse.addEventListener("pointerdown", entry.onPointerDown);
        expand.addEventListener("pointerdown", entry.onPointerDown);

        root.classList.add(ROOT_CLASS);
        composer.classList.add(COMPOSER_CLASS);
        // This is a sibling of the input composer, outside its border and native toolbar.
        composer.append(collapse);
        host.append(dock);
        this.entries.set(root, entry);
        const Observer = getWindow(doc)?.ResizeObserver;
        if (Observer) {
            entry.observer = new Observer(() => this.position(entry));
            entry.observer.observe(root);
            entry.observer.observe(composer);
            entry.observer.observe(send);
        }
        return entry;
    }

    position(entry: ZenEntry) {
        if (this.disposed || this.entries.get(entry.root) !== entry) return;
        const sendBounds = entry.send.getBoundingClientRect();
        const composerBounds = entry.composer.getBoundingClientRect();
        const top = `${sendBounds.top - composerBounds.top + sendBounds.height / 2}px`;
        if (entry.collapse.style.top !== top) entry.collapse.style.top = top;
        const width = `${entry.root.getBoundingClientRect().width}px`;
        if (entry.dock.style.width !== width) entry.dock.style.width = width;
    }

    setCollapsed(entry: ZenEntry, collapsed: boolean) {
        if (this.disposed || this.entries.get(entry.root) !== entry) return;
        if (collapsed) entry.historyExpanded = entry.root.classList.contains("claudian-zen--expanded");
        if (collapsed && entry.root.contains(entry.root.ownerDocument.activeElement)) {
            (entry.root.ownerDocument.activeElement as HTMLElement | null)?.blur();
        }
        entry.root.inert = collapsed || entry.originalInert;
        entry.root.classList.toggle(COLLAPSED_CLASS, collapsed);
        entry.dock.hidden = !collapsed;
        // Native Zen mode folds history on outside clicks, including the external dock.
        if (!collapsed && entry.historyExpanded && !entry.root.classList.contains("claudian-zen--expanded")) {
            entry.root.querySelector<HTMLElement>(".claudian-zen-disclosure")?.click();
        }
        this.position(entry);
    }

    detach(root: HTMLElement) {
        const entry = this.entries.get(root);
        if (!entry) return;
        this.entries.delete(root);
        entry.observer?.disconnect();
        entry.collapse.removeEventListener("click", entry.onCollapse);
        entry.expand.removeEventListener("click", entry.onExpand);
        entry.collapse.removeEventListener("pointerdown", entry.onPointerDown);
        entry.expand.removeEventListener("pointerdown", entry.onPointerDown);
        entry.collapse.remove();
        entry.dock.remove();
        root.inert = entry.originalInert;
        root.classList.remove(ROOT_CLASS, COLLAPSED_CLASS);
        entry.composer.classList.remove(COMPOSER_CLASS);
    }

    dispose() {
        this.disposed = true;
        for (const root of this.entries.keys()) this.detach(root);
    }
}
