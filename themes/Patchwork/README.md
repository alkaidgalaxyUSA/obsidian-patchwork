# Patchwork Theme

Application appearance and native Markdown typography, independent of community
plugin enhancements. The display name and manifest remain Patchwork 0.1.0,
requiring Obsidian 1.14.0 or later.

## Sources

- `src/theme.scss`: the theme entry point, importing only local theme modules.
- `src/app/`: settings, fonts, navigation, dialogs, file explorer, and mobile rules.
- `src/icons/`: replaceable SVG artwork for file-explorer icons.
- `src/editor/`: Markdown typography, tables, headings, callouts, and code colors.
- `src/layouts/`: workspace, document tabs, and status bar.
- `src/elements/`: standard controls, buttons, and focus styles.
- `src/color-schemes/`: light/dark palettes and compatibility mappings.
- `src/features/`: colorblind variants and heading underlines.
- `github.theme.css`: unchanged historical GitHub Theme reference; never imported.
- `img/` and `baseline.png`: theme reference images.

Claudian and Awesome Format Bar styles are owned entirely
by their respective plugin directories. Deleting those directories does not
break theme imports. Formatting, code cards and document typography belong to the unified Patchwork
Editor plugin; the theme provides application appearance and native defaults.

## Appearance

The theme combines GitHub-derived components with Maple typography, palettes,
floating tabs, and file-explorer styles. The explorer has gold folder icons,
file-type icons, accent-filled active rows, and hidden tree guides. Active note
tabs use a brighter background and raised appearance in dark mode.

Yuque-inspired document typography and code-card presentation now belong to
Patchwork Editor, not a duplicated theme module. The theme keeps native component
defaults for documents opened without the editor plugin. Styles do not rewrite
note content.

Interface and document font preferences continue to follow Obsidian Appearance
settings. Unmodified normal/italic Maple Mono font data is embedded for code,
with explicit user monospace-font preferences taking precedence. No font
installation or network request is required.

Retained component rules preserve their relative cascade order. The theme's
original Style Settings namespace and non-plugin option IDs remain unchanged.

## Build and removal

### File explorer icons

Replace the matching SVG file in `src/icons/` without changing its filename:

| File | Usage |
| --- | --- |
| `menu-folder.svg` | Folders, both expanded and collapsed |
| `menu-default.svg` | Files without a dedicated icon |
| `menu-markdown.svg` | Markdown notes |
| `menu-sql.svg` | SQL scripts |
| `menu-shell.svg` | PowerShell, CMD, BAT and SH scripts |

Preserve a valid SVG namespace and `viewBox`. The display size remains 18px.
After replacing an icon, run the theme build below. The build reads these SVGs
and embeds them in the generated CSS, so installed themes remain self-contained
and do not depend on development paths or network resources. Source changes do
not take effect until rebuilt and installed. Do not edit the generated data URLs.

From the repository root:

```powershell
npm run build -- -ThemeOnly
```

Output: `dist/obsidian-patchwork/themes/Patchwork/`.
Default installation: `D:\my-notes\.obsidian\themes\Patchwork`.
Shared build options are documented in the root README. Edit source modules,
not generated CSS. Disabling or removing this theme does not disable companion
plugins; their native Obsidian color fallbacks remain available.

The root LICENSE contains the GitHub Theme and Maple Theme MIT attributions.
The complete Maple Mono OFL notice is embedded in `src/app/fonts.scss` and is
preserved in compiled CSS. `package.psd1` records obsolete license files from
older installations so deployment can remove those copies.
