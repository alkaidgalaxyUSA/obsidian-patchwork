import type { CallContext, Unsubscribe, WindowContext } from "./common";
import type { DocumentLocation, DocumentSnapshot, EditorSelectionSnapshot } from "./content";

export interface CodeDocumentAdapter {
    readonly version: 1;
    supports(leafId: string, context: WindowContext): boolean;
    getSnapshot(leafId: string, context: WindowContext): DocumentSnapshot;
    navigate(location: DocumentLocation, context: CallContext): Promise<void>;
    getSelection(leafId: string, context: WindowContext): EditorSelectionSnapshot | undefined;
    insert(location: DocumentLocation, text: string, context: CallContext): Promise<void>;
    /** Editor protection only; Content retains filesystem permission ownership. */
    setReadOnly(location: DocumentLocation, readOnly: boolean, context: CallContext): void;
    onChange(listener: (snapshot: DocumentSnapshot) => void): Unsubscribe;
}
