import { MarkdownPreviewRenderer, Notice, Menu, setIcon, editorLivePreviewField } from "obsidian";
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
import { NoteOutline } from "./note-outline.js";

// One plugin owns editor extensions, UI and cleanup. No secondary plugin or runtime loader.
export function installEditorRuntime(plugin) {
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
        plugin.noteOutline = new NoteOutline(plugin, setIcon);
        plugin.register(() => plugin.noteOutline.dispose());

}
