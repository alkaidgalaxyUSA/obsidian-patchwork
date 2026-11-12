import { Modal, Notice } from "obsidian";
import { scopeModule } from "../../../utils/module-scope";
import { getServiceRegistry } from "../../../utils/service-registry";
import { resolveWindow } from "../../../utils/windows";
import { openProjectDocument } from "../explorer/document-open";
import { searchFiles, searchCategories, resultKey } from "./search-files";
import { setIcon } from "../utils/icons";
import { explorerFileIcon } from "../utils/file-icons";
import { saveSearch, historyItems } from "./search-history";

export class SearchEverywhereModal extends Modal {
    constructor(plugin, context, lifetime, closed, history) {
        super(plugin.app);
        this.plugin = plugin; this.context = context; this.lifetime = lifetime; this.closedCallback = closed;
        this.mode = "all"; this.results = []; this.selected = 0;
        this.history = history; this.historyIndex = -1; this.options = {};
        this.titleEl.hidden = true;
        this.modalEl.setAttribute("aria-label", "Search project");
        this.modalEl.classList.add("pw-search-everywhere");
        this.scopeLease = scopeModule(this.modalEl, "project", { surface: "search-everywhere" });
    }

    onOpen() {
        if (this.modalEl.ownerDocument !== this.context.document) { this.close(); new Notice("Search is unavailable in this window."); return; }
        this.tabs = this.contentEl.createDiv({ cls: "pw-search-tabs", attr: { role: "tablist", "aria-label": "Search category" } });
        this.tabButtons = new Map();
        for (const [key, name] of searchCategories) {
            const button = this.tabs.createEl("button", { text: name, attr: { type: "button", role: "tab" } });
            button.onclick = () => this.setMode(key);
            this.tabButtons.set(key, button);
        }
        this.input = this.contentEl.createEl("input", { cls: "pw-search-input", type: "search", attr: {
            placeholder: "Search file names or contents…", "aria-label": "Search project", role: "combobox",
            "aria-autocomplete": "list", "aria-expanded": "true", spellcheck: "false",
        } });
        const listId = `pw-search-results-${this.context.windowId}`;
        this.input.setAttribute("aria-controls", listId);
        this.titleEl.id = `${listId}-label`;
        this.titleEl.setText("Search results");
        this.list = this.contentEl.createDiv({ cls: "pw-search-results", attr: { id: listId, role: "listbox", "aria-labelledby": this.titleEl.id } });
        this.pathLabel = this.contentEl.createDiv({ cls: "pw-search-help", attr: { "aria-live": "polite" } });
        this.input.oninput = event => { if (!event.isComposing) { this.historyIndex = -1; this.schedule(); } };
        this.input.oncompositionend = () => this.schedule();
        this.input.onkeydown = event => {
            if (event.isComposing) return;
            clearTimeout(this.openTimer);
            if (event.altKey && ["ArrowUp", "ArrowDown"].includes(event.key)) {
                event.preventDefault(); this.showHistory(event.key === "ArrowUp" ? -1 : 1); return;
            }
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault(); this.select((this.selected + (event.key === "ArrowDown" ? 1 : -1) + this.results.length) % this.results.length);
            } else if (event.key === "PageDown" || event.key === "PageUp") {
                event.preventDefault(); this.select(this.selected + (event.key === "PageDown" ? 10 : -10));
            } else if (event.key === "Enter") { event.preventDefault(); void this.openResult(this.results[this.selected], event.ctrlKey || event.metaKey ? "new-tab" : "reuse"); }
            else if (event.key === "Tab") {
                event.preventDefault(); const modes = [...this.tabButtons.keys()];
                this.setMode(modes[(modes.indexOf(this.mode) + (event.shiftKey ? modes.length - 1 : 1)) % modes.length]);
            }
        };
        this.input.value = historyItems(this.history, "all").at(-1) ?? "";
        this.setMode("all"); this.input.focus(); this.input.select();
        this.refreshRefs = ["create", "modify", "rename", "delete"].map(name => this.app.vault.on(name, () => this.schedule()));
    }

    setMode(mode) {
        if (this.mode !== mode) this.rememberQuery();
        this.mode = mode;
        this.historyIndex = -1;
        for (const [key, button] of this.tabButtons) button.setAttribute("aria-selected", String(key === mode));
        this.schedule(); this.input.focus();
    }

    rememberQuery() {
        const value = this.input?.value.trim();
        saveSearch(this.history, value, this.mode);
    }

    showHistory(direction) {
        const items = historyItems(this.history, this.mode);
        if (!items.length) return;
        this.historyIndex += direction;
        if (this.historyIndex < 0) this.historyIndex = items.length - 1;
        if (this.historyIndex >= items.length) this.historyIndex = 0;
        this.input.value = items[this.historyIndex];
        this.schedule(); this.input.focus(); this.input.select();
    }

    schedule(more = false) {
        clearTimeout(this.openTimer);
        this.request?.abort(); clearTimeout(this.timer);
        const request = this.request = new AbortController();
        const frozen = more ? this.results.filter(result => result.kind !== "more") : [];
        this.options.limit = more ? this.options.limit + (this.mode === "all" ? 15 : 30) : this.mode === "all" ? 15 : 30;
        if (!more) {
            this.results = []; this.selected = 0; this.list.empty(); this.input.removeAttribute("aria-activedescendant");
            this.pathLabel.setText("");
        }
        this.list.setAttribute("aria-busy", "true");
        this.timer = setTimeout(() => {
            void searchFiles(this.app, this.input.value, this.mode, request.signal, snapshot => {
                if (this.closed || request.signal.aborted) return;
                const selectedKey = this.results[this.selected] && resultKey(this.results[this.selected]);
                const existing = new Set(frozen.map(resultKey));
                this.results = [...frozen, ...snapshot.results.filter(result => !existing.has(resultKey(result)))];
                const retained = this.results.findIndex(result => resultKey(result) === selectedKey);
                if (retained >= 0 && selectedKey !== "more") this.selected = retained;
                this.render();
                this.list.setAttribute("aria-busy", String(!snapshot.done));
            }, { ...this.options, matchCase: false, wholeWord: false }).catch(error => {
                if (this.closed || request.signal.aborted) return;
                this.list.setAttribute("aria-busy", "false");
                new Notice(`Search failed: ${error.message}`);
            });
        }, this.input.value.trim() ? 150 : 0);
    }

    render() {
        const scrollTop = this.list.scrollTop;
        this.list.empty();
        for (const [index, result] of this.results.entries()) {
            const row = this.list.createDiv({ cls: "pw-search-result", attr: { role: "option", id: `${this.list.id}-${index}` } });
            setIcon(row.createSpan({ cls: "pw-search-result-icon", attr: { "aria-hidden": "true" } }), result.kind === "more" ? "ellipsis" : result.kind === "action" ? "command" : explorerFileIcon(result.file.path));
            const body = row.createDiv({ cls: "pw-search-result-body" });
            const heading = body.createDiv({ cls: "pw-search-result-heading" });
            if (result.kind === "text") {
                this.highlight(heading.createSpan({ cls: "pw-search-result-preview" }), result.preview, result.previewRanges);
                heading.createSpan({ cls: "pw-search-result-trailing", text: result.file.name });
            } else {
                const name = result.kind === "more" ? "More…" : result.kind === "action" ? result.command.name : result.file.name;
                this.highlight(heading.createSpan({ cls: "pw-search-result-name" }), name, result.nameRanges);
                if (result.file) {
                    this.highlight(heading.createSpan({ cls: "pw-search-result-path" }), result.file.parent?.path || ".", result.pathRanges);
                    const project = heading.createSpan({ cls: "pw-search-result-trailing" });
                    setIcon(project.createSpan({ cls: "pw-search-project-icon", attr: { "aria-hidden": "true" } }), "project-module");
                    project.createSpan({ text: this.app.vault.getName() });
                }
            }
            row.onmousedown = event => { event.preventDefault(); if (event.button === 0) this.select(index, false); };
            row.onclick = event => {
                if (event.button !== 0) return;
                this.select(index, false);
                clearTimeout(this.openTimer);
                // Keep the selection visible briefly before navigation closes the popup.
                this.openTimer = setTimeout(() => { if (!this.closed) void this.openResult(result, event.ctrlKey || event.metaKey ? "new-tab" : "reuse"); }, 100);
            };
        }
        this.select(this.selected, false);
        this.list.scrollTop = scrollTop;
    }

    highlight(element, text, ranges = []) {
        let cursor = 0;
        for (const [start, end] of ranges) {
            if (start >= text.length) break;
            element.appendText(text.slice(cursor, start));
            element.createEl("mark", { text: text.slice(start, end) }); cursor = Math.min(text.length, end);
        }
        element.appendText(text.slice(cursor));
    }

    select(index, scroll = true) {
        this.selected = Number.isFinite(index) ? Math.max(0, Math.min(this.results.length - 1, index)) : 0;
        const rows = this.list.querySelectorAll(".pw-search-result");
        rows.forEach((row, i) => row.setAttribute("aria-selected", String(i === this.selected)));
        const row = rows[this.selected];
        const file = this.results[this.selected]?.file;
        const base = this.app.vault.adapter.getBasePath?.();
        const separator = base?.includes("\\") ? "\\" : "/";
        const path = file && base ? base.replace(/[\\/]+$/, "") + separator + file.path.replace(/\//g, separator) : file?.path ?? this.results[this.selected]?.command?.name ?? "";
        this.pathLabel.setText(path);
        if (!row) { this.input.removeAttribute("aria-activedescendant"); return; }
        this.input.setAttribute("aria-activedescendant", row.id);
        if (scroll) row.scrollIntoView({ block: "nearest" });
    }

    async openResult(result, targetMode = "reuse") {
        if (!result || this.opening) return;
        if (result.kind === "more") { this.schedule(true); return; }
        this.opening = true;
        const context = { ...this.context, signal: this.lifetime.signal };
        try {
            context.signal.throwIfAborted();
            if (result.kind === "action") {
                if (resolveWindow(context.windowId)?.document !== context.document) throw new Error("The window is no longer available.");
                this.close();
                if (!this.app.commands.executeCommandById(result.command.id)) new Notice("This action is unavailable in the current context.");
                return;
            }
            if (resolveWindow(context.windowId)?.document !== context.document || this.app.vault.getAbstractFileByPath(result.file.path) !== result.file) throw new Error("The file or window is no longer available.");
            this.close();
            const location = await openProjectDocument(this.app, result.file, context, targetMode);
            context.signal.throwIfAborted();
            if (resolveWindow(context.windowId)?.document !== context.document) return;
            if (result.line === undefined) return;
            const registry = getServiceRegistry(this.app);
            const target = { ...location, line: result.line, column: result.column };
            const content = registry.get("content");
            if (content) await content.navigate(target, context);
            else {
                const code = registry.get("codeDocument");
                if (code?.supports(location.leafId, context)) await code.navigate(target, context);
                else this.app.workspace.iterateAllLeaves(leaf => {
                    if (leaf.id === location.leafId && leaf.view.containerEl.ownerDocument === context.document && leaf.view.file === result.file) leaf.setEphemeralState({ line: result.line });
                });
            }
        } catch (error) { if (!context.signal.aborted) new Notice(error.message); }
    }

    onClose() {
        this.rememberQuery();
        this.closed = true; this.request?.abort(); clearTimeout(this.timer); clearTimeout(this.openTimer);
        for (const ref of this.refreshRefs ?? []) this.app.vault.offref(ref);
        this.scopeLease.dispose(); this.contentEl.empty(); this.results = []; this.closedCallback();
    }
}
