# Patchwork Theme

Application appearance and native Markdown defaults, independent of community
plugin enhancements. The display name and manifest remain Patchwork 0.1.0,
requiring Obsidian 1.14.0 or later.

## Sources

- `src/theme.scss`: the theme entry point, importing only local theme modules.
- `src/defaults/`: settings, fonts, native controls, typography tokens, navigation, dialogs, workspace/tab/status defaults and mobile rules.
- `../../icons/`: shared SVG artwork used by native theme defaults.
- `src/color-schemes/`: light/dark palettes and compatibility mappings.
- `src/features/`: global colorblind accessibility variants.
- `github.theme.css`: unchanged historical GitHub Theme reference; never imported.
- `img/` and `baseline.png`: theme reference images.

Claudian and Awesome Format Bar styles are owned entirely
by their respective plugin directories. Deleting those directories does not
break theme imports. Formatting, code cards and document typography belong to the unified Patchwork
Editor plugin; the theme provides application appearance and native defaults.

## Appearance

The theme combines GitHub-derived components with Maple typography, palettes,
floating tabs, and file-explorer styles. The explorer has gold folder icons,
file-type icons, accent-filled active rows, and hidden tree guides. Document tab appearance and tab icon mappings are owned by Content. Borders
owns native dock geometry and replacement sidebar controls.

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

File-tree icon mappings and selection/menu presets belong to Project; see
`plugins/project/README.md`. Document tab SVG mappings belong to Content.
Rebuild the owning plugin after changing those assets. The theme retains only
native defaults and its embedded font assets.

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
The complete Maple Mono OFL notice is embedded in `src/defaults/fonts.scss` and is
preserved in compiled CSS. `package.psd1` records obsolete license files from
older installations so deployment can remove those copies.

## Module isolation

Document tables, inline code, headings, callouts and heading underlines live in
`plugins/content/src/styles/theme/`. Saved Style Settings IDs and body setting
flags are retained, while the feature declarations target Content roots.
The theme has no plugin imports and no global native status-bar hide rule.
Borders owns the status shell while enabled; native defaults remain available
when it is disabled. Font and Maple attribution notices remain with their sources.
