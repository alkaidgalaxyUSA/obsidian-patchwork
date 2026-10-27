# Obsidian Patchwork

Independent theme and plugin enhancements for Obsidian.
Repository: https://github.com/alkaidgalaxyUSA/obsidian-patchwork
Local checkout: `D:\ideaProjects\obsidian-patchwork`.

## Ownership and layout

```text
themes/
  Patchwork/                 Application appearance and native theme defaults
    src/                     Theme SCSS only; no community-plugin imports
    manifest.json
    versions.json
    README.md
plugins/
  claudian-extension/        TypeScript Claudian companion
  power-editor/             Unified Patchwork Editor (TypeScript + editor modules)
  code-editor/              Standalone code file editor
  package.json              Shared plugin dependencies and build commands
  manifest.json             Central plugin manifests and runtime packaging configuration
  scripts/                  Unified TypeScript build and deployment
scripts/
  Build-Install.ps1         Compile, package, install and reload in one command
LICENSE                     Consolidated MIT attributions
```

Each plugin directory owns its entry point, runtime modules, and styles.
`plugins/manifest.json` owns all plugin metadata, stylesheet entries, and the
shared runtime file list. `plugins/package.json` provides the single plugin
version; update that version and its lockfile metadata together. Builds generate
an Obsidian-compatible manifest for each plugin in `plugins/dist/<id>/`, using
the shared version. Per-plugin source manifests, `package.psd1`, `versions.json`,
and the legacy deployment guard are no longer used. The theme retains its own
manifest and packaging metadata. No plugin imports a sibling plugin.
The single root script contains its packaging and installation helpers. The theme
has no imports from `plugins/`. Shared appearance values use standard Obsidian
CSS variables, with optional Patchwork values and native fallbacks.

Claudian is a separately installed upstream plugin. This repository maintains
its companion without patching the upstream installation. Patchwork Editor is
an independent Power Editor fork incorporating the former code-block plugin.
Code Editor handles standalone code files. These three plugins share the npm
project under `plugins/` but have independent installed entry points.

| Source directory | Installed plugin ID | Ownership |
| --- | --- | --- |
| `claudian-extension` | `claudian-extension` | Claudian integration only |
| `power-editor` | `patchwork-power-editor` | Unified formatting, code cards, titles, history, navigation and outline |
| `code-editor` | `code-editor` | Standalone SQL, PowerShell and text-file editing |

Disabling a companion restores its upstream interface; removing Markdown code
controls leaves ordinary fenced Markdown and its optional metadata in notes.
The theme display name remains **Patchwork** to preserve existing vault settings.
The Claudian companion is **Claudian Extension**, ID `claudian-extension`.
The repository, npm package, checkout directory, and distribution root are named
**obsidian-patchwork**.

## Encrypted Markdown views

Power Editor shares its toolbar, code cards, title, navigation and outline with
unlocked Meld Encrypt `.mdenc` notes. Meld Encrypt remains a separate plugin and
owns passwords, encryption, saving and locking. The adapter does not change the
encrypted file format or replace Meld's view with a regular Markdown view.

Document and frontmatter actions use the unlocked editor and Meld's save method,
never plaintext writes to encrypted files. Reading-mode edits temporarily use the
source editor and restore Reading View after saving. Headings and frontmatter are
read from the open document without adding decrypted content to the global index.
Locked or unsupported Meld views are not enhanced; unlock the note before editing.
Encrypted notes remain excluded from vault-wide Markdown scans. Attachments are
not encrypted by this integration. Lock/password actions remain in the top bar.

The adapter targets Meld Encrypt 3.1.1's view lifecycle. It fails closed if those
unlock-state properties change. UI compatibility does not add automatic locking
or protect an unlocked session from other plugins.

## SQL section copying

In Code Editor, mark each SQL group with a standalone comment:

```sql
-- @section Find orders
SELECT * FROM orders WHERE customer_id = 1001;

-- @section Repair order status
BEGIN;
UPDATE orders SET status = 'completed' WHERE id = 123;
COMMIT;
```

Hovering highlights the entire group. Right-click inside a group to select its SQL,
then choose **Copy** in the original context menu. The native menu's appearance,
item order and other actions are preserved; no custom menu or inline buttons are added.
Outside a group, right-clicking does not change the selection.
A group ends at the next marker or the end of
the file; semicolons do not split it. Copying excludes the marker and blank edge
lines, but keeps business comments, indentation and every statement in the group.
Markers inside common quoted strings, dollar-quoted bodies and block comments
are ignored. This is a grouping aid, not a complete SQL dialect parser.

The command **Code Editor: Copy SQL selection or current section** copies selected
text first, otherwise the group containing the cursor. Assign a shortcut in
Obsidian's Hotkeys settings if desired; no existing shortcut is overridden.
Empty groups or positions before the first marker show a notice without changing
the clipboard. Files without markers are never copied wholesale as a fallback.
Copying does not change the saved SQL and never executes it. This feature is
limited to `.sql` files; existing files are not automatically regrouped.

## Build and installation

Requirements: PowerShell 7+, Node.js 22+, declared npm dependencies and an open
Obsidian vault. Install declared dependencies explicitly when setting up:

```powershell
npm ci --ignore-scripts
npm --prefix ./plugins ci --ignore-scripts
```

Run the single script from any working directory:

```powershell
& 'D:\ideaProjects\obsidian-patchwork\scripts\Build-Install.ps1'
```

It compiles all configured plugins and themes, packages them, installs them into
`D:\my-notes`, and reloads the plugins. No separate installation command is needed.
The npm entry point performs the same workflow:

```powershell
# From the repository root: build and install every plugin and theme.
npm run build

# From the plugins directory: build and install every plugin, without themes.
npm run build

# Choose a target vault.
npm run build -- -VaultPath D:/my-notes

# Install only one plugin or a selected batch after compilation.
npm run build -- -Plugin power-editor
npm run build -- -Plugin power-editor,code-editor

# Build and install only the theme.
npm run build -- -ThemeOnly
```

The root `scripts` directory contains only `Build-Install.ps1`. Old build-only
and install-only scripts, npm deployment commands, compatibility wrappers,
migration and removal scripts, and the common directory have been removed.
`plugins/scripts/build.mjs` and its two check helpers remain internal compiler
implementation details. Targets are registered in `plugins/manifest.json`;
no hard-coded plugin list needs updating in the PowerShell script.

With `-Plugin`, compilation checks all configured plugins but only selected
plugins are packaged and installed. Both source directory names and installed
plugin IDs are accepted; use comma-separated names for a batch. `-PluginsOnly`
excludes themes. `-ThemeOnly` cannot be combined with plugin selection.

Output:

```text
dist/obsidian-patchwork/
  LICENSE
  themes/Patchwork/{manifest.json,theme.css,.patchwork-files.json}
  plugins/<plugin-id>/{manifest.json,main.js,styles.css,LICENSE,.patchwork-files.json}
```

`plugins/dist` holds intermediate plugin bundles. All selected artifacts and
destinations are validated before any running plugin is disabled. Copied files
are verified with SHA-256; obsolete owned runtime files are removed. Settings,
unknown user files and unselected packages are preserved. Selected plugins are
enabled even if previously disabled. A failed build stops before installation.

Keep the target vault open and enable **Settings > General > Advanced > Command
line interface**. The script verifies the connected vault before copying files.
Use `-ObsidianCliPath` for a custom CLI path. For manual reload, disable affected
plugins first, pass `-SkipReload`, then enable them afterwards. Theme CSS reloads
through Obsidian's file watcher; installation never changes the active theme.

Installation is sequential rather than transactional. If copying or reloading
fails, correct the error and rerun the command before enabling a partially copied
plugin. No dependencies are installed automatically.

## Migration to the unified editor

Build and deploy `patchwork-power-editor`, and disable the old `powereditor`,
`patchwork-code-blocks`, Awesome Format Bar and its style companion. Do not enable
the old editors alongside the fusion. The former `note-code-blocks` source is
now part of `plugins/power-editor/src/editor`, not a second plugin.

The Yuque document stylesheet moved out of the theme into the editor's
`src/styles/foundations.css`. Deploy the updated theme as well to remove its old
copy. The theme continues to own application chrome; Claudian's companion and
its existing ID/data remain separate and unchanged. There is no bulk rewrite of
notes or conversations. Keep old runtime/settings backups for rollback.

## License and attribution

Project code is MIT-licensed under the root `LICENSE`, including the retained
GitHub Theme, Maple Theme, Power Plugins, Patchwork contributors and saltyfireball
copyright notices. Packaged plugin LICENSE files and entry-point/style notices
retain these attributions when packages are distributed separately.

The unmodified bundled Maple Mono font remains under SIL OFL 1.1, not MIT. Its
full required notice is embedded in `themes/Patchwork/src/app/fonts.scss` and
retained in the generated CSS. Third-party dependency licenses inside ignored
`node_modules` belong to those dependencies and are not removed.

## Unified plugin project

Dependencies and TypeScript configuration are shared under `plugins/`.
Nested plugin `package.json` and lockfiles are no longer used. All plugins use
the version in `plugins/package.json`; the root npm project provides the combined
build-and-install command and the theme's Sass dependency.
