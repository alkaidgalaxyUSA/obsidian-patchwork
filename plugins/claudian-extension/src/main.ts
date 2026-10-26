import { Plugin, FileSystemAdapter } from "obsidian";
import { NoteInserter } from "./note-inserter";
import { CodeActions } from "./code-actions";
import { ComposerActions } from "./composer-actions";
import { SidebarActions } from "./sidebar-actions";
import { ZenActions } from "./zen-actions";

export default class ClaudianExtensionPlugin extends Plugin {
    inserter!: NoteInserter;
    actions!: CodeActions;
    composerActions!: ComposerActions;
    sidebarActions!: SidebarActions;
    zenActions!: ZenActions;

    onload() {
        if (!(this.app.vault.adapter instanceof FileSystemAdapter)) {
            throw new Error("Claudian Extension requires a desktop filesystem vault.");
        }
        this.inserter = new NoteInserter(this.app);
        this.actions = new CodeActions(this.inserter);
        this.register(() => this.actions.dispose());
        this.composerActions = new ComposerActions(this.app);
        this.register(() => this.composerActions.dispose());
        this.sidebarActions = new SidebarActions(this.app);
        this.register(() => this.sidebarActions.dispose());
        this.zenActions = new ZenActions(this.app);
        this.register(() => this.zenActions.dispose());

        this.registerEvent(this.app.workspace.on("active-leaf-change", (leaf) => {
            this.inserter.remember(leaf);
        }));
        this.registerEvent(this.app.workspace.on("file-open", () => {
            this.inserter.remember(this.app.workspace.getMostRecentLeaf());
        }));
        this.registerEvent(this.app.workspace.on("layout-change", () => {
            this.attachDocuments();
            this.sidebarActions.sync();
            this.zenActions.sync();
        }));
        this.registerEvent(this.app.workspace.on("window-open", (_workspaceWindow, win) => {
            this.actions.attach(win.document);
        }));

        this.app.workspace.onLayoutReady(() => {
            if (this.actions.disposed) return;
            this.inserter.remember(this.app.workspace.getMostRecentLeaf());
            this.attachDocuments();
            this.composerActions.sync();
            this.sidebarActions.sync();
            this.zenActions.sync();
            // Also catches programmatic draft edits, background work, and newly opened tabs.
            this.registerInterval(window.setInterval(() => {
                this.composerActions.sync();
                this.sidebarActions.sync();
                this.zenActions.sync();
            }, 250));
        });
    }

    attachDocuments() {
        this.actions.attach(this.app.workspace.containerEl.ownerDocument);
        this.app.workspace.iterateAllLeaves((leaf) => {
            this.actions.attach(leaf.view.containerEl.ownerDocument);
        });
    }
};
