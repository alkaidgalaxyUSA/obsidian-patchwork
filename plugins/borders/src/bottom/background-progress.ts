import type { CallContext, Unsubscribe, WindowContext } from "../../../contracts/common";
import type { BackgroundProgressApi, ProgressHandle, ProgressOptions, ProgressSnapshot, ProgressUpdate } from "../../../contracts/progress";
import { ModuleUnavailableError } from "../../../utils/module-errors";
import { resolveWindow } from "../../../utils/windows";

type ProgressListener = (tasks: readonly ProgressSnapshot[]) => void;

interface ProgressWindow {
    context: WindowContext;
    listeners: Set<ProgressListener>;
}

interface ProgressRecord {
    snapshot: ProgressSnapshot;
    onCancel?: () => void | Promise<void>;
    timer?: ReturnType<typeof setTimeout>;
    releaseSignal: () => void;
}

/** Presentation state only. Task execution and cancellation belong to the caller. */
export class BackgroundProgress implements BackgroundProgressApi {
    readonly version = 1;
    private readonly windows = new Map<string, ProgressWindow>();
    private readonly tasks = new Map<string, ProgressRecord>();
    private nextId = 0;
    private disposed = false;

    addWindow(context: WindowContext): void {
        if (this.disposed || this.windows.has(context.windowId)) return;
        this.windows.set(context.windowId, { context, listeners: new Set() });
    }

    private window(context: CallContext): ProgressWindow {
        context.signal?.throwIfAborted();
        const host = this.windows.get(context.windowId);
        if (this.disposed || !host || host.context.document !== context.document
            || resolveWindow(context.windowId)?.document !== context.document) {
            throw new ModuleUnavailableError("borders", "Background progress is unavailable in this window.");
        }
        return host;
    }

    private validate(update: ProgressUpdate): void {
        if (update.title !== undefined && !update.title.trim()) throw new Error("A progress task requires a title.");
        if (update.fraction !== undefined && update.fraction !== null
            && (!Number.isFinite(update.fraction) || update.fraction < 0 || update.fraction > 1)) {
            throw new Error("Progress fraction must be null or a number between 0 and 1.");
        }
    }

    start(options: ProgressOptions): ProgressHandle {
        this.window(options.context);
        if (typeof options.title !== "string" || !options.title.trim()) throw new Error("A progress task requires a title.");
        this.validate(options);
        const id = `pw-progress-${++this.nextId}`;
        const record: ProgressRecord = {
            snapshot: Object.freeze({ id, owner: options.owner, windowId: options.context.windowId,
                title: options.title, details: options.details ?? "", fraction: options.fraction ?? null,
                state: "running", cancellable: !!options.onCancel, visible: false }),
            onCancel: options.onCancel,
            releaseSignal: () => {},
        };
        this.tasks.set(id, record);
        const finish = () => this.finish(id);
        const signal = options.context.signal;
        if (signal) {
            signal.addEventListener("abort", finish, { once: true });
            record.releaseSignal = () => signal.removeEventListener("abort", finish);
        }
        // Fast tasks never flash in the footer. Animation does not depend on updates.
        record.timer = setTimeout(() => {
            record.timer = undefined;
            if (this.tasks.get(id) !== record) return;
            record.snapshot = Object.freeze({ ...record.snapshot, visible: true });
            this.publish(record.snapshot.windowId);
        }, 200);
        this.publish(options.context.windowId);
        return { id, update: update => this.update(id, update), cancel: () => this.cancel(id), finish, dispose: finish };
    }

    private update(id: string, update: ProgressUpdate): void {
        const record = this.tasks.get(id);
        if (!record || this.disposed) return;
        this.validate(update);
        const previous = record.snapshot;
        const title = update.title ?? previous.title;
        const details = update.details ?? previous.details;
        const fraction = update.fraction === undefined ? previous.fraction : update.fraction;
        if (title === previous.title && details === previous.details && fraction === previous.fraction) return;
        record.snapshot = Object.freeze({ ...previous, title, details, fraction });
        this.publish(previous.windowId);
    }

    cancel(id: string): void {
        const record = this.tasks.get(id);
        if (!record?.onCancel || record.snapshot.state === "cancelling" || this.disposed) return;
        record.snapshot = Object.freeze({ ...record.snapshot, state: "cancelling", cancellationError: undefined });
        this.publish(record.snapshot.windowId);
        // A failed cancellation can be retried; success still waits for caller.finish().
        void Promise.resolve().then(() => {
            if (this.tasks.get(id) === record && !this.disposed) return record.onCancel?.();
        }).catch(() => {
            if (this.tasks.get(id) !== record || this.disposed) return;
            record.snapshot = Object.freeze({ ...record.snapshot, state: "running", cancellationError: "Cancellation failed. Try again." });
            this.publish(record.snapshot.windowId);
        });
    }

    private finish(id: string): void {
        const record = this.tasks.get(id);
        if (!record) return;
        this.tasks.delete(id);
        if (record.timer !== undefined) clearTimeout(record.timer);
        record.releaseSignal();
        this.publish(record.snapshot.windowId);
    }

    getTasks(context: WindowContext): readonly ProgressSnapshot[] {
        this.window(context);
        return this.snapshot(context.windowId);
    }

    subscribe(context: WindowContext, listener: ProgressListener): Unsubscribe {
        const host = this.window(context);
        host.listeners.add(listener);
        this.deliver(listener, this.snapshot(context.windowId));
        return () => { host.listeners.delete(listener); };
    }

    private snapshot(windowId: string): readonly ProgressSnapshot[] {
        return Object.freeze([...this.tasks.values()].filter(record => record.snapshot.windowId === windowId).map(record => record.snapshot));
    }

    private deliver(listener: ProgressListener, tasks: readonly ProgressSnapshot[]): void {
        try { listener(tasks); }
        catch (error) { console.error("Patchwork progress subscriber failed.", error); }
    }

    private publish(windowId: string): void {
        const host = this.windows.get(windowId);
        if (!host) return;
        const tasks = this.snapshot(windowId);
        for (const listener of [...host.listeners]) if (host.listeners.has(listener)) this.deliver(listener, tasks);
    }

    removeWindow(windowId: string): void {
        const host = this.windows.get(windowId);
        this.windows.delete(windowId);
        for (const [id, record] of this.tasks) if (record.snapshot.windowId === windowId) this.finish(id);
        if (host) {
            for (const listener of [...host.listeners]) this.deliver(listener, Object.freeze([]));
            host.listeners.clear();
        }
    }

    dispose(): void {
        this.disposed = true;
        for (const id of this.windows.keys()) this.removeWindow(id);
    }
}
