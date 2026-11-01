import type { CallContext, Unsubscribe, WindowContext } from "./common";

export interface DocumentLocation {
    leafId: string; path: string; line?: number; column?: number; scrollTop?: number;
}
export interface HeadingItem {
    id: string; label: string; level: number; line: number;
    children: readonly HeadingItem[];
}
export interface DocumentSnapshot {
    windowId: string; location?: DocumentLocation;
    displayPath?: string; cursor?: { line: number; column: number };
    scrollTop?: number;
    encoding?: string; lineEnding?: "LF" | "CRLF";
    canChangeEncoding?: boolean; encodingPending?: boolean;
    readOnly?: boolean; lockPending?: boolean; canToggleReadOnly: boolean;
    mode?: "source" | "preview" | "code";
    activeHeadingTrail: readonly HeadingItem[];
}
export interface DocumentOpenRequest extends CallContext {
    path: string; target: "reuse" | "new-tab" | "split";
    groupLeafId?: string; focus?: boolean;
}
export interface InsertRequest extends CallContext {
    text: string; mode: "auto" | "raw" | "fenced";
    language?: string; target?: DocumentLocation;
}
export interface ContentApi {
    readonly version: 1;
    openDocument(request: DocumentOpenRequest): Promise<DocumentLocation>;
    getDocument(context: WindowContext): DocumentSnapshot;
    onDocument(listener: (snapshot: DocumentSnapshot) => void): Unsubscribe;
    getHeadings(location: DocumentLocation, context: CallContext): Promise<readonly HeadingItem[]>;
    navigate(location: DocumentLocation, context: CallContext): Promise<void>;
    toggleReadOnly(location: DocumentLocation, context: CallContext): Promise<void>;
    setEncoding(location: DocumentLocation, context: CallContext, encoding: string): Promise<void>;
    insert(request: InsertRequest): Promise<void>;
    getSelection(context: WindowContext): EditorSelectionSnapshot | undefined;
    onSelection(listener: (snapshot: EditorSelectionSnapshot | undefined) => void): Unsubscribe;
    reviewUnreferencedImages(context: CallContext): Promise<void>;
}
export interface EditorSelectionSnapshot {
    windowId: string;
    location: DocumentLocation; selectedText: string;
    lineCount: number; startLine?: number;
}
