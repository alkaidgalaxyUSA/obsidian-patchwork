import type { WorkspaceSidedock } from "obsidian";

export type SidebarDock = WorkspaceSidedock & {
    containerEl: HTMLElement;
    size: number;
    resizeHandleEl?: HTMLElement;
    setSize?: (width: number) => unknown;
};
