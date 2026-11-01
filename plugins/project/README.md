# Patchwork Project

Project owns native file-tree controls, selection, search, rename/clipboard/file
menus, compact rows, preset appearance and Git status presentation. The installed
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
