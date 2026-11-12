import type { CallContext, Unsubscribe } from "./common";
import type { FileMenuContext, MenuAction } from "./project";

export type GitFileState = "added" | "modified" | "deleted" | "conflict" | "ignored" | "unversioned";
export interface GitSnapshot {
    ready: boolean; busy: boolean; error?: string;
    branch?: string; detachedCommit?: string;
    sync?: { status: "compared" | "unpublished" | "unavailable"; tracking: boolean; comparison?: string; ahead?: number; behind?: number };
    status: readonly { vaultPath: string; originalVaultPath?: string; state: GitFileState }[];
}
export interface GitApi {
    readonly version: 1;
    getSnapshot(): GitSnapshot;
    onSnapshot(listener: (snapshot: GitSnapshot) => void): Unsubscribe;
    refresh(context: CallContext): Promise<void>;
    /** UTF-8 HEAD baseline for an ordinary text file; never accepts editor contents. */
    getFileBaseline?(path: string, context: CallContext): Promise<{ revision: string; text: string } | undefined>;
    openCommit(paths: readonly string[], context: CallContext): Promise<void>;
    openLog(context: CallContext): Promise<void>;
    showDiff(paths: readonly string[], options: { newTab?: boolean }, context: CallContext): Promise<void>;
    buildFileActions(context: FileMenuContext): readonly MenuAction[];
}
