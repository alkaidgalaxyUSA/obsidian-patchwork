import type { CallContext, Disposable, FileTarget, ModuleId, Unsubscribe, WindowContext } from "./common";

export interface MenuAction {
    id: string; label: string; icon?: string; disabledReason?: string;
    children?: readonly MenuAction[];
    separatorBefore?: boolean;
    run?: () => void | Promise<void>;
}
export interface FileMenuContext extends CallContext {
    targets: readonly FileTarget[];
    source: "project" | "document" | "other";
}
export interface FileMenuContribution {
    id: string; owner: ModuleId; group: "git" | "extras"; order: number;
    build(context: FileMenuContext): readonly MenuAction[];
}
export interface ProjectApi {
    readonly version: 1;
    reveal(path: string, context: CallContext): Promise<void>;
    getSelection(context: WindowContext): readonly FileTarget[];
    onSelection(listener: (context: WindowContext, targets: readonly FileTarget[]) => void): Unsubscribe;
    registerFileMenu(contribution: FileMenuContribution): Disposable;
}
