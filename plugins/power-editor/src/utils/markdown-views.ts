import { App, MarkdownView, TFile, WorkspaceLeaf } from "obsidian";

export const MARKDOWN_VIEW_SELECTOR = '.workspace-leaf-content:is([data-type="markdown"], .pw-markdown-view)';

type MeldView = MarkdownView & {
    isSavingEnabled?: boolean;
    isUnlocking?: boolean;
    isLoadingFileInProgress?: boolean;
};

export function isEncryptedNote(file: TFile): boolean {
    return file.extension.toLowerCase() === "mdenc";
}

/** Meld owns unlock/save state. Unknown versions fail closed instead of exposing UI. */
export function isMarkdownView(view: unknown): view is MarkdownView {
    if (!(view instanceof MarkdownView)) return false;
    if (view.getViewType() === "markdown") return true;
    if (view.getViewType() !== "meld-encrypted-view" || !view.file || !isEncryptedNote(view.file)) return false;
    const meld = view as MeldView;
    return meld.isSavingEnabled === true && meld.isUnlocking === false && meld.isLoadingFileInProgress === false;
}

export function markdownLeaves(app: App): WorkspaceLeaf[] {
    return ["markdown", "meld-encrypted-view"].flatMap(type => app.workspace.getLeavesOfType(type))
        .filter(leaf => isMarkdownView(leaf.view));
}

export function markdownViews(app: App): MarkdownView[] {
    return markdownLeaves(app).map(leaf => leaf.view as MarkdownView);
}

export function activeMarkdownView(app: App): MarkdownView | null {
    const view = app.workspace.getActiveViewOfType(MarkdownView);
    return isMarkdownView(view) ? view : null;
}

export function unlockedNoteView(app: App, file: TFile): MarkdownView | undefined {
    const active = activeMarkdownView(app);
    return active?.file === file ? active : markdownViews(app).find(view => view.file === file);
}
