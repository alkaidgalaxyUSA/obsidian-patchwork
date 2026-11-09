# Patchwork Project

Project owns native file-tree controls, selection, search, rename/clipboard/file
menus, compact rows, GitHub appearance and Git status presentation. The installed
ID is `patchwork-project`. Borders optionally hosts its native panel and rail;
Content optionally provides document opening and attachment review; Git publishes
semantic status snapshots and file actions. No sibling implementation is imported.

## File-tree icons

Replace matching repository-root SVG assets without changing their filenames:

| Asset | Usage |
| --- | --- |
| `menu-folder.svg` | Expanded and collapsed folders |
| `menu-default.svg` | Files without a dedicated icon |
| `menu-markdown.svg` | Markdown notes |
| `menu-sql.svg` | SQL scripts |
| `menu-shell.svg` | Shell scripts |
| `menu-locked.svg` | Encrypted Markdown files |

Keep a valid SVG namespace and viewBox. Rebuild/install the Project target to
embed updated assets in its CSS. The repository development rules require an
explicit request before executing a build. Existing SVG geometry is retained
until the migration plan's ownership acceptance gate permits normalization.

## Compatibility

Project migrates validated missing preferences target-first from Content and
preserves unknown data. Attachment-folder hiding retains its original default.
Optional native-core, Excalidraw and Meld compatibility stays in named adapters.
A missing capability produces an explicit unavailable result or native fallback.
Existing main-window native tree enhancement boundaries remain; pop-out behavior,
menu placement and native control restoration require the live acceptance checks
in `docs/module-isolation-acceptance.md`.

## Explorer appearance

Explorer rows and menus use the same 12px Microsoft YaHei UI typography as Git.
Live IDEA Project View inspection on 2026-11-06 confirmed a 12px regular tree
font, a bold fragment for the project content root, foreground `#D1D3D9`, and
LCD HRGB antialiasing with integer metrics at 1x scale. The root resolves to
Windows `msyhbd.ttc`; ordinary rows resolve to `msyh.ttc`. Project mirrors that
font/weight/color split without enlarging or whitening the root text. A rendered
`my-notes` sample occupied 58 by 13 pixels in both runtimes; this is a measured
sample comparison, not a claim of pixel-identical rendering for every label.

## Search Everywhere

Press and release Shift twice to search project file names, paths and text.
All, Files, Actions and Text tabs filter results; arrow keys select, Enter opens, Tab
switches categories and Escape closes. Text results navigate to the matching line.
The shortcut follows IDEA's modifier double-click timing and ignores key chords.
Search is limited to vault-visible files. All loads 15 results per source and
individual tabs load 30; More continues loading. Binary, encrypted, unsupported and over-5-MiB files are not
searched as text. Pending searches are cancelled when replaced or closed.
File matching and history algorithms are adapted from pinned IDEA sources.
Actions search Obsidian commands; file suffixes such as `file.sql:31:2` navigate
to a line and column. See [source mapping and limitations](src/search/SOURCE.md).

Project-tree Git Add remains clickable. It refreshes status and stages unstaged
files in the selected scope; no unstaged files means no operation. A busy or
unavailable repository does not start another operation.

The Appearance submenu retains only GitHub Theme. Legacy Patchwork, Maple and
Border selections migrate to GitHub on settings load, preserving unrelated
settings. Their alternate explorer styles are no longer bundled.
