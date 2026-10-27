# Shared icons

This directory is the single editable source for Patchwork SVG icons. The former
`themes/Patchwork/src/icons` files have moved here; do not keep a second copy.

Open `preview.html` in a browser for a labeled gallery. `usage.json` lists the
source files associated with each icon, including icon-picker choices.

## Common replacements

| File | Usage |
| --- | --- |
| `menu-folder.svg` | Explorer folders |
| `menu-markdown.svg` | Markdown notes |
| `menu-default.svg` | Other documents |
| `menu-sql.svg` | SQL scripts |
| `menu-shell.svg` | PS1, CMD, BAT and SH scripts |
| `menu-locked.svg` | Encrypted Markdown (`.mdenc`) |
| `code-run.svg` | PowerShell Run button, editing and reading modes |
| `code-fold.svg` | Code-block and Markdown-heading fold indicators |
| `code-header-toggle.svg` | Code header toggle and Claudian Zen expansion |
| `code-drag.svg` | Code-block and paragraph drag handles |
| `action-copy.svg` | Copy actions in our editor and Claudian extension |
| `action-arrow-left-right.svg` | Adaptive code-block width |
| `action-chevrons-up-down.svg` | Code language and theme selectors |
| `action-ellipsis.svg` | Horizontal More buttons |
| `action-ellipsis-vertical.svg` | Toolbar overflow button |
| `action-eye.svg`, `action-eye-closed.svg` | Outline auto-hide / pinned states |
| `action-bold.svg`, `action-italic.svg`, `action-underline.svg` | Formatting toolbar |
| `action-heading-1.svg` through `action-heading-6.svg` | Heading choices |
| `action-arrow-up.svg`, `action-square.svg` | Claudian extension Send / Stop |
| `action-chevron-left.svg`, `action-chevron-right.svg` | Claudian extension sidebar controls and other navigation |
| `action-file-code.svg` | Code Editor view icon |
| `tab-audio.svg`, `tab-video.svg`, `tab-document.svg`, `tab-database.svg` | Theme-controlled tab icons |

Other `action-*.svg` files use their original icon names and cover our toolbar,
menus, dialogs and icon-picker choices. A shared action icon is intentionally
reused across our plugins, rather than copied for each button.

## Editing and applying

1. Replace an SVG in place without renaming it. Keep the SVG namespace and a
   valid `viewBox`; 24, 100 and 1024 coordinate systems are supported.
2. Use `currentColor` for single-color controls so they work in light and dark
   themes. Explorer document artwork retains its explicit colors.
3. Keep assets self-contained. Scripts, event handlers, external references,
   embedded images and foreign HTML are not supported.
4. From the repository root, run `npm run build` to build, install and reload.
   For only `menu-*` or `tab-*` changes, `npm run build -- -ThemeOnly` is enough.

Assets are embedded at build time. Installed plugins do not read this development
directory, watch it, or write any note data. Editing an SVG requires rebuilding;
refreshing `preview.html` alone only refreshes the gallery.

Plugin icon IDs are namespaced per plugin and registered lazily. Unloading a
plugin removes its registrations without replacing Obsidian's global icons.

## Scope

Included: UI created by Patchwork Editor, Code Editor, Claudian Extension, and
SVG shapes explicitly customized by the Patchwork theme.

Not included: Obsidian's untouched native UI, system context-menu icons, original
Claudian/Meld/Notebook Navigator/Excalidraw controls, user note emoji and images.
Moving a native toolbar button does not transfer ownership of its icon. Such
controls retain their original icon providers; no global icon override is used.
CSS layout decorations such as borders, resize handles and caret edges are not
icon assets.

## Attribution

`action-*` assets were exported through the installed Obsidian icon API from the
icons referenced by our sources. Lucide and Feather notices are retained in
`LICENSE-Lucide.txt` and the repository license shipped with the packages.
`code-run.svg` uses the user-supplied circular-play geometry with theme-aware color.
The existing user-supplied document artwork is preserved in `menu-*` assets.
