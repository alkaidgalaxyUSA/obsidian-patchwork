import type { CallContext, Disposable, ModuleId, Unsubscribe, WindowContext } from "./common";

export interface ProgressUpdate {
    title?: string;
    details?: string;
    /** null means indeterminate; numbers must be finite and between 0 and 1. */
    fraction?: number | null;
}

export interface ProgressOptions extends ProgressUpdate {
    owner: ModuleId;
    title: string;
    /** The signal controls presentation lifetime, not execution or cancellation. */
    context: CallContext;
    /** Request cancellation in the caller. The caller must still finish the task. */
    onCancel?: () => void | Promise<void>;
}

export interface ProgressSnapshot {
    readonly id: string;
    readonly owner: ModuleId;
    readonly windowId: string;
    readonly title: string;
    readonly details: string;
    readonly fraction: number | null;
    readonly state: "running" | "cancelling";
    readonly cancellable: boolean;
    readonly visible: boolean;
    readonly cancellationError?: string;
}

export interface ProgressHandle extends Disposable {
    readonly id: string;
    /** Updates after finish, disposal or host unload are ignored. */
    update(update: ProgressUpdate): void;
    cancel(): void;
    /** Removes presentation only; never stops or changes caller-owned work. */
    finish(): void;
}

export interface BackgroundProgressApi {
    readonly version: 1;
    start(options: ProgressOptions): ProgressHandle;
    getTasks(context: WindowContext): readonly ProgressSnapshot[];
    /** Immediately delivers the current immutable snapshot, then subsequent changes. */
    subscribe(context: WindowContext, listener: (tasks: readonly ProgressSnapshot[]) => void): Unsubscribe;
}
