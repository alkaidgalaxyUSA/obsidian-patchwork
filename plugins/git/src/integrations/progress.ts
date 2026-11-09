import type { App } from "obsidian";
import type { CallContext } from "../../../contracts/common";
import type { BackgroundProgressApi, ProgressHandle } from "../../../contracts/progress";
import { getServiceRegistry } from "../../../utils/service-registry";
import { getWindowContext, resolveWindow } from "../../../utils/windows";

interface GitProgressTask {
    context: CallContext;
    title: string;
    handle?: ProgressHandle;
    onCancel?: () => void | Promise<void>;
}

/** Optional presentation adapter; provider replacement never restarts Git work. */
export class GitProgress {
    private readonly lifetime = new AbortController();
    private readonly tasks = new Set<GitProgressTask>();
    private readonly unwatch: () => void;
    private provider?: BackgroundProgressApi;

    constructor(app: App) {
        this.unwatch = getServiceRegistry(app).watch("git", "borders", borders => {
            this.provider = borders?.progress;
            for (const task of this.tasks) {
                task.handle?.finish();
                task.handle = undefined;
                this.attach(task);
            }
        });
    }

    private attach(task: GitProgressTask): void {
        if (!this.provider || this.lifetime.signal.aborted
            || resolveWindow(task.context.windowId)?.document !== task.context.document) return;
        try {
            task.handle = this.provider.start({ owner: "git", title: task.title, context: task.context, fraction: null, onCancel: task.onCancel });
        } catch (error) {
            // A missing footer or closing window must not redirect or cancel Git work.
            if (!(error instanceof Error && "code" in error && error.code === "MODULE_UNAVAILABLE")) {
                console.error("Git progress presentation failed.", error);
            }
        }
    }

    start(title: string, document: Document, onCancel?: () => void | Promise<void>): () => void {
        if (this.lifetime.signal.aborted) return () => {};
        const task: GitProgressTask = {
            title, onCancel, context: { ...getWindowContext(document), signal: this.lifetime.signal },
        };
        this.tasks.add(task);
        this.attach(task);
        return () => {
            task.handle?.finish();
            this.tasks.delete(task);
        };
    }

    dispose(): void {
        this.unwatch();
        this.lifetime.abort();
        for (const task of this.tasks) task.handle?.finish();
        this.tasks.clear();
        this.provider = undefined;
    }
}
