import type { View, WorkspaceSidedock } from "obsidian";

export interface CodeBlock { text: string; language: string; }
export type InsertMode = "auto" | "raw" | "fenced";

// Only the upstream Claudian fields consumed by this extension are described here.
// Runtime capability checks remain in place because these are not public APIs.
export interface ClaudianTab {
    dom?: { inputEl?: HTMLTextAreaElement; inputWrapper?: HTMLElement };
    controllers: {
        inputController: {
            sendMessage(): unknown;
            cancelStreaming(): unknown;
            isPreparingMainTurn?: boolean;
        };
        sideChatController: {
            cancelSide(): unknown;
            destination?: string;
            isWorking?: boolean;
            runtime?: { isWorking?: boolean };
        };
    };
    state: { isStreaming: boolean };
    hydrationState?: string;
    session?: { hasMainBackgroundWork?: boolean; runtime?: { mailbox?: { hasPending?: boolean } } };
}

export interface ClaudianView extends View {
    getTabManager?(): { getAllTabs(): ClaudianTab[] };
}

export type SidebarDock = WorkspaceSidedock & {
    containerEl: HTMLElement;
    size: number;
    setSize?: (width: number) => unknown;
};

export interface ComposerEntry {
    tab: ClaudianTab;
    input: HTMLTextAreaElement;
    toolbar: HTMLElement;
    permission: HTMLElement;
    marker: Comment;
    button: HTMLButtonElement;
    pending: boolean;
    onInput: () => void;
    onClick: () => void;
}

export interface SidebarEntry {
    panel: HTMLElement;
    actions: HTMLElement;
    nav: HTMLElement;
    marker: Comment;
    toolbar: HTMLElement;
    menuHeight?: string;
}

export interface SidebarHandle {
    dock: SidebarDock;
    edge: HTMLElement;
    button: HTMLButtonElement;
    onClick: (event: MouseEvent) => void;
    onPointerDown: (event: PointerEvent) => void;
}

export interface WidthLimit {
    dock: SidebarDock;
    original: (width: number) => unknown;
    descriptor?: PropertyDescriptor;
    enabled: boolean;
    setSize: (this: SidebarDock, width: number) => unknown;
}

export interface ZenEntry {
    root: HTMLElement;
    host: HTMLElement;
    composer: HTMLElement;
    send: HTMLElement;
    collapse: HTMLButtonElement;
    dock: HTMLElement;
    expand: HTMLButtonElement;
    originalInert: boolean;
    historyExpanded?: boolean;
    observer?: ResizeObserver;
    onCollapse: (event: MouseEvent) => void;
    onExpand: (event: MouseEvent) => void;
    onPointerDown: (event: PointerEvent) => void;
}
