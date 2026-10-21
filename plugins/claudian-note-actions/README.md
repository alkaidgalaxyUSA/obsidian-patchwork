# Claudian Note Actions

A small, dependency-free Obsidian companion plugin for inserting Claudian code
blocks into Markdown notes and adding composer actions. It does not modify
Claudian's installed files or the Patchwork theme.

## Usage

1. Enable **Claudian Note Actions** under Obsidian's Community plugins.
2. Open the destination Markdown note in editing mode (Live Preview or Source).
3. Place the cursor at the insertion point, then return to Claudian.
4. Hover a code block and click the **Insert into note** icon. Its tooltip also
   shows the destination note. Tooltips, menus, and operation notices use English.

Markdown-language blocks are inserted as Markdown source. Other languages,
including unlabeled blocks, are inserted with fenced code syntax. The overflow
menu explicitly selects raw source or a fenced code block. Copy, insert, and
overflow controls share one icon-only toolbar floating on the top-right edge of
the code block. The toolbar appears on hover or keyboard focus (and stays visible
on touch devices); hovering an icon shows its tooltip. It does not reserve a header
row. Language badges and duplicate native copy controls are hidden, and extra
header padding from the Colorful Code Blocks snippet is removed only for enhanced
chat code blocks. Syntax highlighting and fenced-insertion metadata remain
unchanged. The copy action delegates to Claudian's original copy control and
copies only the code content. No clipboard access is needed for insertion.

Keyboard users can focus a code block or its toolbar and press **Ctrl+Enter**.
The shortcut does not run from the chat composer, note editor, or other inputs.
Hovering alone does not activate the shortcut.

## Composer actions

The existing permission control (such as **Full access**) appears immediately
after the context-usage percentage and keeps its original menu and behavior.
A compact icon button occupies the far right of the input toolbar:

- **Send message**: a gray arrow with no background, disabled when the input is empty or whitespace-only;
  a white up arrow on blue when text is present and the conversation is ready.
- **Stop (Esc)**: a solid square inside a subtle circular background while preparing or running a turn,
  including main-chat background work. Clicking it invokes the same cancellation
  methods as Escape for the current main or side conversation, without sending
  the current draft or merely dismissing an open dropdown.

The composer placeholder is dimmed without changing actual input text.
Tooltips use Obsidian's default style. Input events update the button immediately;
a 250 ms refresh also detects runtime transitions, programmatic edits, and new
tabs. Unloading restores the permission control's original position and removes
the button and its listeners.

## Safety and limitations

- Inserts at the most recently active Markdown note's current cursor. An
  existing selection is not replaced, and multiple cursors are rejected.
- Uses Obsidian's editor API so changes participate in normal save and undo.
- Reading mode, closed notes, and missing targets are rejected instead of
  guessing a file or silently appending to another note.
- The target must still show the same file; no persistent cursor offsets are
  stored across note changes or application restarts.
- Fenced insertion adds blank-line separators and uses a sufficiently long
  fence when the content itself contains backticks. Use raw insertion when
  inserting inside an existing code fence, list, or quoted block.
- Inserts only the code block's text, never the language badge or toolbar.
- Inserting a still-streaming block captures its text at the time of the click.
- No history editing, file overwrite, smart merge, terminal execution, or new
  file creation is included.
- The integration targets Claudian 2.3.27's `.claudian-code-wrapper > pre > code`
  markup. A future DOM change may require an adapter update. The plugin fails
  closed when that structure is missing.
- Unloading removes its observers, event listeners, and injected controls.
- Composer actions integrate with Claudian 2.3.27's internal tab manager and
  input controllers. They are not a stable public API. The action is not added
  when the expected runtime methods or composer markup are unavailable; future
  Claudian updates may require an adapter update.

## Files and deployment

The runtime uses plain CommonJS JavaScript: no package installation or build is
required. Ship `manifest.json`, `main.js`, `note-inserter.js`, `code-actions.js`,
`composer-actions.js`, `styles.css`, and `utils/code-block.js` together under
`.obsidian/plugins/claudian-note-actions/`.

Source directory: `D:\ideaProjects\obsidian-theme-patchwork\plugins\claudian-note-actions`.
Default destination: `D:\my-notes\.obsidian\plugins\claudian-note-actions`.

Use the theme project's shared entry point to package and install both the theme
and this plugin:

```powershell
pwsh -NoProfile -File "D:\ideaProjects\obsidian-theme-patchwork\scripts\Build-Theme.ps1"
```

The plugin package is written to `dist/claudian-note-actions/`; its JavaScript
is syntax-checked and copied unchanged. The shared script compiles the theme,
prepares both packages, and verifies copied files by hash. It does not enable
the plugin or modify vault settings. Disable the plugin before updating its
files, then re-enable it. Pass `-VaultPath` to target another initialized vault.

Note insertion uses the public Obsidian workspace and editor APIs and reads
Claudian's rendered code-block DOM. Composer actions additionally use the
version-specific Claudian runtime integration described above.
