import { getWindowContext, resolveWindow } from "../../utils/windows";
import { ModuleUnavailableError } from "../../utils/module-errors";
import { upstreamTabs, activeUpstreamTab } from "./integrations/upstream";
import { Notice } from "obsidian";
import type { App, Editor, Menu, WorkspaceLeaf } from "obsidian";
import { iconName } from "./utils/icons";
import type { ClaudianEditorSelection, ClaudianView, EditorSelectionContext } from "./types";

interface SelectionHook {
    prototype: ClaudianEditorSelection;
    descriptor: PropertyDescriptor;
    replacement: () => void;
}

/** Keep native selection chips and submission handling, but require an explicit action. */
export class SelectionActions {
    private hooks = new Map<object, SelectionHook>();
    private initialized = new WeakSet<ClaudianEditorSelection>();
    private disposed = false;

    constructor(private readonly app: App) {}

    sync(): void {
        if (this.disposed) return;
        for (const leaf of this.app.workspace.getLeavesOfType("claudian-view")) {
            for (const tab of upstreamTabs(leaf)) this.prepare(tab.controllers?.composerSelections?.editor);
        }
    }

    private prepare(selection?: ClaudianEditorSelection): selection is ClaudianEditorSelection {
        if (!selection || typeof selection.poll !== "function" || typeof selection.clear !== "function" ||
            typeof selection.updateIndicator !== "function" || typeof selection.getContext !== "function" ||
            !("storedSelection" in selection)) return false;
        const prototype = Object.getPrototypeOf(selection) as ClaudianEditorSelection;
        if (!this.hooks.has(prototype)) {
            const descriptor = Object.getOwnPropertyDescriptor(prototype, "poll");
            if (!descriptor?.configurable || typeof descriptor.value !== "function") return false;
            // A prototype hook also covers new conversation tabs before their first poll.
            // No upstream files, browser selections or canvas selections are modified.
            const replacement = () => {};
            Object.defineProperty(prototype, "poll", { ...descriptor, value: replacement });
            this.hooks.set(prototype, { prototype, descriptor, replacement });
        }
        if (!this.initialized.has(selection)) {
            this.initialized.add(selection);
            selection.clear();
        }
        return true;
    }

    addEditorMenu(menu: Menu, editor: Editor, path?: string, doc = this.app.workspace.containerEl.ownerDocument): void {
        const selectedText = editor.getSelection();
        if (!path || !selectedText.trim()) return;
        // Capture at menu creation: focusing the chat must not change the selection.
        const context: EditorSelectionContext = {
            notePath: path,
            selectedText,
            lineCount: selectedText.split(/\r?\n/).length,
            startLine: editor.getCursor("from").line + 1,
        };
        menu.addItem(item => item.setTitle("Add selection to Claudian")
            .setIcon(iconName("message-circle")).setSection("selection")
            .onClick(() => { void this.attach(context, doc); }));
    }

    private async conversationLeaf(doc: Document): Promise<WorkspaceLeaf | undefined> {
        const leaves = this.app.workspace.getLeavesOfType("claudian-view").filter(leaf => leaf.view.containerEl.ownerDocument === doc);
        const focused = doc.activeElement;
        const existing = leaves.find(leaf => focused && leaf.view.containerEl.contains(focused)) ??
            leaves.find(leaf => leaf.view.containerEl.getClientRects().length > 0) ?? leaves[0];
        if (existing) return existing;
        if (doc !== this.app.workspace.containerEl.ownerDocument) throw new ModuleUnavailableError("claudian", "Open a Claudian conversation in this window before attaching a selection.");
        const leaf = this.app.workspace.getRightLeaf(false);
        if (!leaf) return undefined;
        await leaf.setViewState({ type: "claudian-view", active: true });
        return leaf;
    }

    async attach(context: EditorSelectionContext, doc = this.app.workspace.containerEl.ownerDocument): Promise<void> {
        if (this.disposed) return;
        const windowContext = getWindowContext(doc);
        const current = () => !this.disposed && resolveWindow(windowContext.windowId)?.document === doc;
        try {
            if (!current()) return;
            const leaf = await this.conversationLeaf(doc);
            if (!leaf || !current() || leaf.view.containerEl.ownerDocument !== doc) return;
            await this.app.workspace.revealLeaf(leaf);
            if (!current() || leaf.view.containerEl.ownerDocument !== doc || leaf.view.getViewType() !== "claudian-view") return;
            const tab = activeUpstreamTab(leaf);
            const selection = tab?.controllers?.composerSelections?.editor;
            if (!this.prepare(selection) || !tab?.dom?.inputEl) {
                new Notice("Claudian is not ready to attach a selection. Open a conversation and try again.");
                return;
            }
            selection.clear();
            // Store a snapshot, not a live editor/DOM range. Subsequent selections
            // cannot replace it, and the note may be edited or closed safely.
            selection.storedSelection = { ...context };
            selection.updateIndicator();
            selection.onUserSelectionChanged?.();
            tab.dom.inputEl.focus();
        } catch (error) {
            console.error("Claudian Extension: selection attachment failed", error);
            new Notice("Could not attach the selection to Claudian. Please try again.");
        }
    }

    dispose(): void {
        this.disposed = true;
        for (const hook of this.hooks.values()) {
            if (hook.prototype.poll === hook.replacement) Object.defineProperty(hook.prototype, "poll", hook.descriptor);
        }
        this.hooks.clear();
    }
}
