import type { CallContext, Disposable, ModuleId, PanelId, Unsubscribe, WindowContext } from "./common";
import type { BackgroundProgressApi } from "./progress";

export interface PanelState {
    id: PanelId; windowId: string; visible: boolean; focused: boolean;
}
export interface PanelOpenOptions {
    context: CallContext; focus?: boolean; payload?: { cwd?: string; newTab?: boolean };
}
export interface PanelInstance extends Disposable {
    show(options: PanelOpenOptions): Promise<void>;
    hide(): void;
    focus(): void;
    resize(bounds: DOMRectReadOnly): void;
}
export interface PanelDefinition {
    id: PanelId; owner: Exclude<ModuleId, "borders">;
    label: string; icon: string; dock: "left" | "right" | "bottom";
    rail: "left" | "right"; railGroup: "main" | "tools"; order: number;
    bounds?: { minWidth?: number; maxWidth?: number; maxWidthRatio?: number; minHeight?: number };
    resizeMode?: "live" | "preview";
    host: { kind: "native-leaf"; viewType: string } | { kind: "element" };
    create(host: HTMLElement, context: WindowContext): PanelInstance | Promise<PanelInstance>;
}
export interface HeaderContribution {
    id: string; owner: Exclude<ModuleId, "borders">; order: number;
    mount(host: HTMLElement, context: WindowContext): Disposable;
}
export interface SettingsContribution {
    id: string; owner: Exclude<ModuleId, "borders">;
    target: "editor"; order: number;
    mount(host: HTMLElement): Disposable;
}
export interface TabActionsContribution {
    id: string; owner: "content"; context: WindowContext; groupId: string;
    container: HTMLElement; controls: readonly HTMLElement[];
}
export interface BordersApi {
    readonly version: 1;
    /** Optional for compatibility with older Borders providers. */
    readonly progress?: BackgroundProgressApi;
    registerPanel(definition: PanelDefinition): Disposable;
    registerHeader(contribution: HeaderContribution): Disposable;
    registerSettings(contribution: SettingsContribution): Disposable;
    registerTabActions(contribution: TabActionsContribution): Disposable;
    openPanel(id: PanelId, options: PanelOpenOptions): Promise<void>;
    togglePanel(id: PanelId, options: PanelOpenOptions): Promise<void>;
    hidePanel(id: PanelId, context: WindowContext): void;
    getPanelState(id: PanelId, context: WindowContext): PanelState | undefined;
    onPanelState(listener: (state: PanelState) => void): Unsubscribe;
}
