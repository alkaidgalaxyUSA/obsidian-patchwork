const { Plugin, FileSystemAdapter, MarkdownView, Notice, Menu, setIcon } = require("obsidian");
const { createRequire } = require("module");
const { join } = require("path");

module.exports = class ClaudianNoteActionsPlugin extends Plugin {
    onload() {
        const adapter = this.app.vault.adapter;
        if (!(adapter instanceof FileSystemAdapter)) {
            throw new Error("Claudian Note Actions requires a desktop filesystem vault.");
        }
        // Obsidian's injected require does not resolve sibling plugin modules.
        const localRequire = createRequire(join(adapter.getBasePath(), this.manifest.dir, "main.js"));
        for (const file of ["./note-inserter", "./code-actions", "./composer-actions", "./utils/code-block"]) {
            delete localRequire.cache[localRequire.resolve(file)];
        }
        const { NoteInserter } = localRequire("./note-inserter");
        const { CodeActions } = localRequire("./code-actions");
        const { ComposerActions } = localRequire("./composer-actions");
        this.inserter = new NoteInserter(this.app, { MarkdownView, Notice });
        this.actions = new CodeActions(this.inserter, { Menu, setIcon });
        this.register(() => this.actions.dispose());
        this.composerActions = new ComposerActions(this.app, { setIcon, Notice });
        this.register(() => this.composerActions.dispose());

        this.registerEvent(this.app.workspace.on("active-leaf-change", (leaf) => {
            this.inserter.remember(leaf);
        }));
        this.registerEvent(this.app.workspace.on("file-open", () => {
            this.inserter.remember(this.app.workspace.getMostRecentLeaf());
        }));
        this.registerEvent(this.app.workspace.on("layout-change", () => {
            this.attachDocuments();
        }));
        this.registerEvent(this.app.workspace.on("window-open", (_workspaceWindow, win) => {
            this.actions.attach(win.document);
        }));

        this.app.workspace.onLayoutReady(() => {
            if (this.actions.disposed) return;
            this.inserter.remember(this.app.workspace.getMostRecentLeaf());
            this.attachDocuments();
            this.composerActions.sync();
            // Also catches programmatic draft edits, background work, and newly opened tabs.
            this.registerInterval(window.setInterval(() => this.composerActions.sync(), 250));
        });
    }

    attachDocuments() {
        this.actions.attach(this.app.workspace.containerEl.ownerDocument);
        this.app.workspace.iterateAllLeaves((leaf) => {
            this.actions.attach(leaf.view.containerEl.ownerDocument);
        });
    }
};
