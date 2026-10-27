import { setIcon } from "../../utils/icons";
import { Notice} from "obsidian";
import type { App } from "obsidian";
import type { ClaudianTab, ClaudianView, ComposerEntry } from "./types";
const TOOLBAR_CLASS = "claudian-extension-composer-toolbar";
const BUTTON_CLASS = "claudian-extension-send";

export class ComposerActions {
    private entries = new Map<ClaudianTab, ComposerEntry>();
    private disposed = false;

    constructor(private readonly app: App) {}

    sync() {
        if (this.disposed) return;
        const current = new Set<ClaudianTab>();
        for (const leaf of this.app.workspace.getLeavesOfType("claudian-view")) {
            const manager = (leaf.view as ClaudianView).getTabManager?.();
            if (typeof manager?.getAllTabs !== "function") continue;
            for (const tab of manager.getAllTabs()) {
                const input = tab.dom?.inputEl;
                const toolbar = tab.dom?.inputWrapper?.querySelector<HTMLElement>(":scope > .claudian-input-toolbar");
                if (!input?.isConnected || !toolbar?.isConnected || !this.isCompatible(tab)) continue;
                const previous = this.entries.get(tab);
                if (previous && (previous.toolbar !== toolbar || previous.input !== input)) this.detach(tab);
                const entry = this.entries.get(tab) ?? this.attach(tab, input, toolbar);
                if (!entry) continue;
                current.add(tab);
                this.render(entry);
            }
        }
        for (const tab of this.entries.keys()) {
            if (!current.has(tab)) this.detach(tab);
        }
    }

    isCompatible(tab: ClaudianTab) {
        const controller = tab.controllers?.inputController;
        const side = tab.controllers?.sideChatController;
        return typeof controller?.sendMessage === "function"
            && typeof controller.cancelStreaming === "function"
            && typeof side?.cancelSide === "function"
            && typeof tab.state?.isStreaming === "boolean"
            && typeof tab.dom?.inputEl?.value === "string";
    }

    attach(tab: ClaudianTab, input: HTMLTextAreaElement, toolbar: HTMLElement): ComposerEntry | undefined {
        const meter = toolbar.querySelector<HTMLElement>(":scope > .claudian-context-meter");
        const permission = toolbar.querySelector<HTMLElement>(":scope > .claudian-permission-toggle");
        if (!meter || !permission) return undefined;
        const doc = toolbar.ownerDocument;
        const marker = doc.createComment("claudian-extension-permission-position");
        permission.before(marker);
        meter.after(permission);
        const button = doc.createElement("button");
        button.type = "button";
        button.className = BUTTON_CLASS;
        toolbar.classList.add(TOOLBAR_CLASS);
        toolbar.append(button);
        const entry: ComposerEntry = { tab, input, toolbar, permission, marker, button, pending: false,
            onInput: () => this.render(entry), onClick: () => { void this.activate(entry); } };
        input.addEventListener("input", entry.onInput);
        button.addEventListener("click", entry.onClick);
        this.entries.set(tab, entry);
        return entry;
    }

    isRunning(tab: ClaudianTab) {
        // Match Claudian 2.3.27's Escape routing, including preparation and background work.
        const side = tab.controllers.sideChatController;
        if (side.destination === "side") return Boolean(side.isWorking || side.runtime?.isWorking);
        return Boolean(tab.state.isStreaming
            || tab.controllers.inputController.isPreparingMainTurn
            || tab.session?.hasMainBackgroundWork
            || tab.session?.runtime?.mailbox?.hasPending);
    }

    render(entry: ComposerEntry) {
        if (this.disposed || this.entries.get(entry.tab) !== entry) return;
        const running = this.isRunning(entry.tab);
        const mode = running ? "stop" : "send";
        const disabled = !running && (entry.pending || !entry.input.value.trim()
            || entry.tab.hydrationState !== "ready");
        if (entry.button.dataset.mode !== mode) {
            entry.button.dataset.mode = mode;
            entry.button.setAttribute("aria-label", running ? "Stop (Esc)" : "Send message");
            setIcon(entry.button, running ? "square" : "arrow-up");
            const svg = entry.button.querySelector<HTMLElement>("svg");
            svg?.setAttribute("aria-hidden", "true");
            if (!running && svg) {
                // Keep the native stroke style and arrowhead width, with a longer shaft.
                const path = svg.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "path");
                path.setAttribute("d", "M12 21V3 M5 10l7-7 7 7");
                svg.replaceChildren(path);
            }
        }
        if (entry.button.disabled !== disabled) entry.button.disabled = disabled;
    }

    async activate(entry: ComposerEntry) {
        const { tab, button, input } = entry;
        const previousMode = button.dataset.mode;
        this.render(entry);
        // Do not send a draft if a displayed Stop button became stale just before the click.
        if (this.disposed || this.entries.get(tab) !== entry || button.disabled
            || button.dataset.mode !== previousMode || !input.isConnected) return;
        try {
            input.focus();
            if (this.isRunning(tab)) {
                const side = tab.controllers.sideChatController;
                // Call the same cancellation methods as Escape, without closing a menu instead.
                if (side.destination === "side") await side.cancelSide();
                else await tab.controllers.inputController.cancelStreaming();
                return;
            }
            if (entry.pending) return;
            entry.pending = true;
            this.render(entry);
            await tab.controllers.inputController.sendMessage();
        } catch (error) {
            console.error("Claudian Extension: composer action failed", error);
            new Notice("The composer action failed. Check the conversation before trying again.");
        } finally {
            // A stop click must not release an outstanding send invocation's guard.
            if (previousMode === "send") entry.pending = false;
            this.render(entry);
        }
    }

    detach(tab: ClaudianTab) {
        const entry = this.entries.get(tab);
        if (!entry) return;
        this.entries.delete(tab);
        entry.input.removeEventListener("input", entry.onInput);
        entry.button.removeEventListener("click", entry.onClick);
        entry.button.remove();
        entry.toolbar.classList.remove(TOOLBAR_CLASS);
        entry.marker.replaceWith(entry.permission);
    }

    dispose() {
        this.disposed = true;
        for (const tab of this.entries.keys()) this.detach(tab);
    }
}
