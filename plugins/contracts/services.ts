import type { BordersApi } from "./borders";
import type { ClaudianApi } from "./claudian";
import type { CodeDocumentAdapter } from "./code-document";
import type { ContentApi } from "./content";
import type { GitApi } from "./git";
import type { ProjectApi } from "./project";
import type { TerminalApi } from "./terminal";
import type { Disposable, ModuleId, Unsubscribe } from "./common";

export interface ServiceMap {
    borders: BordersApi;
    project: ProjectApi;
    content: ContentApi;
    git: GitApi;
    terminal: TerminalApi;
    claudian: ClaudianApi;
    codeDocument: CodeDocumentAdapter;
}

/**
 * Version 1 discovery is shared by independent bundles on the same App.
 * Watchers receive availability immediately and on each provider change.
 * Clients dispose old contributions before binding to a replacement provider.
 * Every handle belongs to its registering instance; a logical module label is
 * never a bulk-disposal key (Content and Code Editor have separate lifecycles).
 * Plugin unload must release its own watcher/provider handles. Duplicate live
 * providers are rejected. Subscriber failures do not interrupt other clients.
 */
export interface ServiceRegistry {
    register<K extends keyof ServiceMap>(owner: ModuleId, key: K, api: ServiceMap[K]): Disposable;
    get<K extends keyof ServiceMap>(key: K): ServiceMap[K] | undefined;
    watch<K extends keyof ServiceMap>(owner: ModuleId, key: K,
        listener: (api: ServiceMap[K] | undefined) => void): Unsubscribe;
}
