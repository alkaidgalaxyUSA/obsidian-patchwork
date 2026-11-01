import { scopeProjectModal } from "../utils/portals";
import { Modal, Notice, SuggestModal, TFile } from "obsidian";

export function chooseExplorerFile(app, title, files, onChoose) {
    const modal = new SuggestModal(app);
    modal.setPlaceholder(title);
    modal.getSuggestions = query => files.filter(file => file.path.toLowerCase().includes(query.toLowerCase()));
    modal.renderSuggestion = (file, el) => el.setText(file.path);
    modal.onChooseSuggestion = file => Promise.resolve().then(() => onChoose(file)).catch(error => new Notice(error.message));
    scopeProjectModal(modal);
    modal.open();
    return modal;
}

export function showExplorerComparison(app, left, right) {
    const modal = new Modal(app);
    modal.setTitle(`Compare: ${left.name} / ${right.name}`);
    modal.modalEl.classList.add("pw-file-comparison");
    const columns = modal.contentEl.createDiv({ cls: "pw-file-comparison-columns" });
    for (const entry of [left, right]) {
        const column = columns.createDiv();
        column.createEl("h3", { text: entry.name });
        column.createEl("pre", { text: entry.text });
    }
    scopeProjectModal(modal);
    modal.open();
    return modal;
}

/** Preview literal replacements, then back up each file before applying them. */
export function showExplorerReplace(app, target) {
    const modal = new Modal(app);
    modal.setTitle("Replace in Files");
    modal.contentEl.createEl("p", { text: `Scope: ${target.path}` });
    const form = modal.contentEl.createEl("form", { cls: "pw-explorer-create-form" });
    const findLabel = form.createEl("label", { text: "Find (literal, case sensitive)" });
    const find = findLabel.createEl("input", { type: "text" });
    const replaceLabel = form.createEl("label", { text: "Replace with" });
    const replace = replaceLabel.createEl("input", { type: "text" });
    const preview = form.createEl("button", { text: "Preview", attr: { type: "submit" } });
    const results = modal.contentEl.createDiv({ attr: { role: "status" } });
    const apply = modal.contentEl.createEl("button", { text: "Replace All", cls: "mod-warning" });
    apply.disabled = true;
    let matches = [];
    let generation = 0;
    let busy = false;
    const invalidate = () => { generation++; matches = []; apply.disabled = true; results.empty(); };
    find.addEventListener("input", invalidate);
    replace.addEventListener("input", invalidate);
    modal.onClose = () => { generation++; };
    form.addEventListener("submit", async event => {
        event.preventDefault();
        if (!find.value || busy) return;
        invalidate();
        const revision = generation;
        const needle = find.value;
        const replacement = replace.value;
        const files = app.vault.getFiles().filter(file => (target instanceof TFile ? file === target
            : !target.parent || file.path.startsWith(`${target.path}/`))
            && ["markdown", "code-editor"].includes(app.viewRegistry.typeByExtension[file.extension]));
        busy = true; preview.disabled = true;
        try {
            const found = [];
            for (const file of files) {
                const before = await app.vault.read(file);
                const parts = before.split(needle);
                if (parts.length > 1) found.push({ file, before, after: parts.join(replacement), count: parts.length - 1 });
            }
            if (revision !== generation) return;
            matches = found;
            results.createEl("p", { text: `${matches.reduce((sum, entry) => sum + entry.count, 0)} matches in ${matches.length} files.` });
            for (const entry of matches) results.createEl("p", { text: `${entry.file.path}: ${entry.count}` });
            apply.disabled = !matches.length;
        } catch (error) { new Notice(error.message); }
        finally { busy = false; preview.disabled = false; }
    });
    apply.onclick = async () => {
        if (busy || !matches.length) return;
        busy = true; apply.disabled = true; preview.disabled = true;
        find.disabled = true; replace.disabled = true;
        let changed = 0;
        try {
            for (const entry of matches) {
                let unsaved = false;
                app.workspace.iterateAllLeaves(leaf => {
                    if (leaf.view.file === entry.file && (leaf.view.dirty || leaf.view.saving || leaf.view.isSavingInProgress)) unsaved = true;
                });
                if (unsaved) throw new Error(`Save ${entry.file.path} and preview again before replacing.`);
                if (await app.vault.read(entry.file) !== entry.before) throw new Error(`${entry.file.path} changed. Preview again before replacing.`);
                await app.fileManager.storeTextFileBackup(entry.file.path, entry.before);
                await app.vault.process(entry.file, current => {
                    if (current !== entry.before) throw new Error(`${entry.file.path} changed. Preview again before replacing.`);
                    return entry.after;
                });
                changed++;
            }
            modal.close();
        } catch (error) { new Notice(error.message); }
        finally {
            new Notice(`Replaced text in ${changed} files.`);
            busy = false; preview.disabled = false; find.disabled = false; replace.disabled = false;
            invalidate();
        }
    };
    scopeProjectModal(modal);
    modal.open(); find.focus();
    return modal;
}
