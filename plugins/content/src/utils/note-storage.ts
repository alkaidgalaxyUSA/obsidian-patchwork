import { App, Notice, TFile, getFrontMatterInfo, parseYaml, stringifyYaml } from "obsidian";
import { EditorView } from "@codemirror/view";
import { isEncryptedNote, unlockedNoteView } from "./markdown-views";

/** Never pass encrypted files to Vault.process or FileManager.processFrontMatter. */
export async function processNote(app: App, file: TFile, change: (text: string) => string): Promise<string> {
    if (!isEncryptedNote(file)) return app.vault.process(file, change);
    const view = unlockedNoteView(app, file);
    if (!view) {
        new Notice("Unlock this encrypted note before editing it.");
        return "";
    }
    const reading = view.getMode() === "preview";
    try {
        // MarkdownView saves currentMode.get(): editing its hidden source editor in
        // Reading View would otherwise save the old preview text over the edit.
        if (reading) await view.setState({ ...view.getState(), mode: "source" }, { history: false });
        if (view.file !== file || unlockedNoteView(app, file) !== view) return "";
        const editor = view.editor;
        if ((editor as typeof editor & { cm?: EditorView }).cm?.state.readOnly) return "";
        const before = editor.getValue();
        const after = change(before);
        if (before === after) return after;
        // A minimal editor transaction keeps selection and undo; Meld encrypts saves.
        let from = 0;
        while (from < before.length && from < after.length && before[from] === after[from]) from++;
        let end = before.length, nextEnd = after.length;
        while (end > from && nextEnd > from && before[end - 1] === after[nextEnd - 1]) { end--; nextEnd--; }
        editor.replaceRange(after.slice(from, nextEnd), editor.offsetToPos(from), editor.offsetToPos(end));
        await view.save();
        return after;
    } catch {
        new Notice("Could not update the encrypted note. Check its unlock state and frontmatter, then try again.");
        return "";
    } finally {
        if (reading && view.file === file && unlockedNoteView(app, file) === view && view.getMode() === "source") {
            await view.setState({ ...view.getState(), mode: "preview" }, { history: false });
        }
    }
}

function frontmatter(text: string): Record<string, unknown> {
    const info = getFrontMatterInfo(text);
    const parsed: unknown = info.exists ? parseYaml(info.frontmatter) : {};
    if (parsed == null) return {};
    if (typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Frontmatter must be a mapping.");
    return parsed as Record<string, unknown>;
}

export function noteFrontmatter(app: App, file: TFile): Record<string, unknown> | undefined {
    if (!isEncryptedNote(file)) return app.metadataCache.getFileCache(file)?.frontmatter;
    const view = unlockedNoteView(app, file);
    if (!view) return undefined;
    try { return frontmatter(view.editor.getValue()); } catch { return undefined; }
}

export async function processNoteFrontmatter(app: App, file: TFile, change: (data: Record<string, unknown>) => void): Promise<void> {
    if (!isEncryptedNote(file)) return app.fileManager.processFrontMatter(file, change);
    await processNote(app, file, text => {
        const info = getFrontMatterInfo(text);
        const data = frontmatter(text);
        change(data);
        const yaml = stringifyYaml(data);
        return `---\n${yaml}${yaml.endsWith("\n") ? "" : "\n"}---\n${text.slice(info.exists ? info.contentStart : 0)}`;
    });
}
