export type ModuleId = "borders" | "project" | "content" | "git" | "terminal" | "claudian";
export type PanelId = "project" | "git:commit" | "git:log" | "bookmarks" | "terminal" | "claudian";
export type Edge = "top" | "left" | "right" | "bottom";
export type Unsubscribe = () => void;
export interface Disposable { dispose(): void; }
export interface WindowContext { windowId: string; document: Document; }
export interface CallContext extends WindowContext { signal?: AbortSignal; }
export interface FileTarget { path: string; kind: "file" | "directory"; }
