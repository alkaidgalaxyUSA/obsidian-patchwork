# Patchwork

A custom Obsidian theme based on
[GitHub Theme by @krios2146](https://github.com/krios2146/obsidian-theme-github).

## Source Layout

```text
src/
  theme.scss          Main entry
  app/                Shared variables, settings, navigation, dialogs, and mobile
  editor/             Typography, blocks, tables, callouts, headings, and code
  layouts/            Workspace, tabs, and status bar
  elements/           Form controls, buttons, and focus styles
  color-schemes/       Color mappings and dark/light palettes
  features/           Colorblind variants and heading underlines
  plugins/
    kanban/           Common, minimal, full, and compatibility styles
    hover-editor.scss Hover Editor integration
plugins/
  claudian-note-actions/  Companion plugin source and documentation
```

The source tree combines GitHub-derived components with Maple typography,
light/dark palettes, floating document tabs, and a Maple-derived file explorer. The previous
Baseline SCSS modules and the temporary `src/github/` layer have been removed.

## Files and Build Workflow

- `manifest.json` identifies Patchwork version 0.1.0 and requires Obsidian 1.14.0
  or later.
- `src/theme.scss` imports the component modules, Maple palettes and tabs,
  bundled Maple Mono fonts, and the scoped file-explorer module.
- `github.theme.css` is the original reference stylesheet and remains unchanged.
- `dist/Patchwork/theme.css` is the compiled stylesheet produced by the build script.
- `plugins/claudian-note-actions/` contains the companion plugin's maintained source.
- `dist/claudian-note-actions/` contains its packaged runtime files.
- `versions.json` records the compatibility of the current Patchwork version.

### Requirements

- PowerShell 7 or later.
- Node.js 20.19.0 or later and npm on PATH.
- An existing Obsidian vault with a `.obsidian` directory.

### First Build and Deployment

Run this from any PowerShell window:

```powershell
pwsh -NoProfile -File "D:\ideaProjects\obsidian-theme-patchwork\scripts\Build-Theme.ps1" -InstallDependencies
```

The explicit `-InstallDependencies` option allows the script to install the pinned
Sass dependency into this project's `node_modules` if it is missing or mismatched.
It uses `npm install` initially, or `npm ci` when a lockfile already exists.
No global packages or system settings are changed. npm lifecycle scripts are
disabled. Keep the generated `package-lock.json` in version control for repeatable
dependency installation.

### Subsequent Builds

After changing theme or companion plugin source, run:

```powershell
pwsh -NoProfile -File "D:\ideaProjects\obsidian-theme-patchwork\scripts\Build-Theme.ps1"
```

The script validates the companion plugin's JavaScript syntax and compiles
`src/theme.scss` with expanded output to preserve the Style Settings comment.
It prepares both packages before deployment:

| Package | Build output | Default installation directory |
| --- | --- | --- |
| Theme, manifest, and licenses | `dist/Patchwork/` | `D:\my-notes\.obsidian\themes\Patchwork` |
| Companion plugin runtime | `dist/claudian-note-actions/` | `D:\my-notes\.obsidian\plugins\claudian-note-actions` |

The plugin's JavaScript is packaged unchanged, without additional dependencies
or bundling. File copies are hash-verified. Source validation, compilation, or
packaging failure prevents deployment of both packages. Deployment itself is
sequential, not a cross-directory atomic transaction; an I/O failure during
installation may leave a partial update and is reported as an error.

To use another vault, pass its absolute path with `-VaultPath`. Only the
`Patchwork` theme and `claudian-note-actions` plugin runtime files are updated;
other themes, other plugins, plugin data, and vault settings are not changed.
Conflicting theme or plugin destinations are rejected before deployment.

On first use, manually select **Patchwork** in Obsidian **Settings > Appearance**.
If the new theme does not appear, reopen Obsidian. Later CSS updates normally
reload automatically. The script runs once and exits; run it again after edits.

Enable **Claudian Note Actions** manually under **Settings > Community plugins**
on first use. For later plugin updates, disable it before deployment and enable
it again afterwards. The script does not reload or automatically enable plugins.
See [the companion plugin guide](plugins/claudian-note-actions/README.md) for usage.

## Preservation Rules

Custom properties are grouped by responsibility. They remain CSS custom
properties, not Sass variables, so runtime customization continues to work.
Typography and color values follow Maple instead of the original GitHub defaults.

Retained component rules preserve their relative cascade order. Mobile inherits
the shared Maple palettes without the old GitHub dark overrides. Optional
colorblind variants follow the palettes, and Kanban fixes retain their late position.

The Style Settings panel name, namespace, option IDs, and defaults remain those
of the imported GitHub Theme. Settings are not migrated automatically.

The file explorer in `src/app/file-explorer.scss` adapts Maple Theme v1.5.14:
gold open/closed folder icons, file-type icons, left-aligned toolbar buttons,
and accent-filled active rows. Colors use Patchwork's light/dark palette.
Tree guides remain hidden, rows use standard padding without extra height,
and folders use a pointer cursor outside rename/drag operations.
These rules are scoped to the file explorer, not the outline or settings menus.
Icons are enabled directly without depending on Maple's Style Settings classes;
Maple's optional title wrapping and bold-folder settings are not imported.

Typography follows Maple's defaults: UI sizes of 13/14/16px, normal/tight line
heights of 1.8/1.5, and heading size ratios of 1.6/1.5/1.4/1.3/1.2/1.1.
Interface and text fonts, plus the base editor font size, continue to follow
Obsidian's Appearance preferences, as they do in Maple by default. Code uses
Maple Mono, with the original normal and italic WOFF2 data embedded in
`src/app/fonts.scss`; no font installation or network request is required.
Explicit user monospace-font preferences still take precedence.

The shared, light, and dark palette modules copy Maple v1.5.14's global color
rules and formulas. They respect Obsidian's accent settings and derive muted
backgrounds, borders, and accents from them. Compatibility mappings connect
retained buttons, headings, inline code, and Kanban components to the new palette.
Maple's optional palette-class rules are retained, but its Style Settings panel
is not imported. Obsidian's light/dark mode preference is not changed.

`src/layouts/tabs.scss` uses Maple's floating document tabs, rounded active tab,
spacing, file-type icons, and hover transitions. These defaults do not require
Maple's Style Settings classes. Panel slide-up animations are not imported,
and reduced-motion preferences disable the tab transitions.

Edit the corresponding SCSS module instead of duplicating rules in the compiled
stylesheet. Do not import `github.theme.css` alongside the modular source.

Claudian retains its native font inheritance, matching Maple's default approach:
body text and the composer use Obsidian's text font, and controls retain their
own font rules. Code and tool output use local Consolas (falling back to Cascadia
Mono or the system monospace font), at 14px with a 1.6 line height and ligatures
disabled; Markdown code blocks use 15px. No blanket font override or Songti
override is applied. Prose typography, syntax colors, and the input layout are
unchanged. The right-sidebar composer
uses 15px text. Task checkboxes have scoped spacing and checkmark sizing to keep
them within the message and their own borders.

## License

Patchwork is licensed under the [MIT License](LICENSE). The imported GitHub
Theme code is copyright (c) 2023 Vladimir Kidyaev and retains its
[original MIT notice](licenses/github-theme-MIT.txt).

The adapted file-explorer, typography, palette, and tab styles from
[Maple Theme](https://github.com/subframe7536/obsidian-theme-maple) are copyright
(c) 2022 subframe7536 and retain their
[original MIT notice](licenses/maple-theme-MIT.txt).

The bundled Maple Mono font data is copyright (c) 2022 subframe7536, with
Reserved Font Name Maple Mono, and remains licensed under the
[SIL Open Font License 1.1](licenses/maple-mono-OFL.txt), not the project's MIT license.
