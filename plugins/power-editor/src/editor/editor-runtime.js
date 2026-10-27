import { setIcon } from "../../../utils/icons";
import { MarkdownPreviewRenderer, Notice, Menu, editorLivePreviewField } from "obsidian";
import { EditorView, Decoration, ViewPlugin, keymap } from "@codemirror/view";
import { EditorState, EditorSelection, StateField, StateEffect, ChangeSet, Prec, Text, Transaction } from "@codemirror/state";
import { defaultKeymap, undo, redo, invertedEffects, isolateHistory } from "@codemirror/commands";
import { syntaxTree, highlightingFor } from "@codemirror/language";
import { highlightTree } from "@lezer/highlight";
import { CodeHeaderWidget, CodeBodyWidget, CodeReadingChild } from "./code-widgets.js";
import { NoteCodeEditor } from "./note-code-editor.js";
import { NoteTitle } from "./note-title.js";
import { NoteHistory } from "./note-history.js";
import { NoteNavigation } from "./note-navigation.js";
import { WindowActions } from "./window-actions.js";
import { installExplorerActions } from "./explorer-actions.js";
import { installAboutTab } from "../settings/about-tab.js";
import { NoteOutline } from "./note-outline.js";
import { installLiteralTextInput } from "./literal-text-input";

// One plugin owns editor extensions, UI and cleanup. No secondary plugin or runtime loader.
export function installEditorRuntime(plugin) {
        installLiteralTextInput(plugin);
        plugin.noteCodeEditor = new NoteCodeEditor(plugin, {
            EditorView, EditorState, EditorSelection, Decoration, ViewPlugin, StateField, StateEffect, ChangeSet, Prec, Text, Transaction, keymap,
            defaultKeymap, undo, redo, invertedEffects, isolateHistory, syntaxTree, highlightingFor, highlightTree,
            BodyWidget: CodeBodyWidget,
            HeaderWidget: CodeHeaderWidget, ReadingChild: CodeReadingChild, MarkdownPreviewRenderer,
            editorLivePreviewField, Menu, Notice, setIcon,
        });
        plugin.register(() => plugin.noteCodeEditor.dispose());
        plugin.noteTitle = new NoteTitle(plugin, plugin.noteCodeEditor);
        plugin.register(() => plugin.noteTitle.dispose());
        plugin.noteHistory = new NoteHistory(plugin, plugin.noteCodeEditor, plugin.noteTitle);
        plugin.register(() => plugin.noteHistory.dispose());
        plugin.noteNavigation = new NoteNavigation(plugin);
        plugin.register(() => plugin.noteNavigation.dispose());
        plugin.windowActions = new WindowActions(plugin);
        plugin.register(() => plugin.windowActions.dispose());
        installAboutTab(plugin);
        installExplorerActions(plugin);
        plugin.noteOutline = new NoteOutline(plugin, setIcon);
        plugin.register(() => plugin.noteOutline.dispose());

}
