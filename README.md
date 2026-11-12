# Obsidian Patchwork

Independent theme and plugin enhancements for Obsidian.
Source ownership is split across seven independent packages. See the
[migration status](docs/module-isolation-migration-progress.md) and
[runtime acceptance checklist](docs/module-isolation-acceptance.md) for verification and release gates.
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
  borders/                   Window chrome and generic panel hosts
  claudian/                  TypeScript Claudian companion
  content/                   Patchwork Editor and document implementations
    code-editor/             Independent code-file editor package
  git/                       Native Git tools
  project/                   Native file tree, selection, search and file menus
  terminal/                  Terminal sessions, tabs and isolated xterm rendering
  contracts/                 Types-only module service contracts
  utils/                     Shared infrastructure
  package.json              Shared plugin dependencies and build commands
  manifest.json             Central plugin manifests and runtime packaging configuration
  scripts/                  Unified TypeScript build and deployment
scripts/
  Build-Install.ps1         Build, install and reload all plugins sequentially
  Install.ps1               Per-plugin functions and deployment transaction
  Reload-Plugins.ps1        Build, install and reload selected plugins
LICENSE                     Consolidated MIT attributions
```

Each plugin directory owns its entry point, runtime modules, and styles.
`plugins/manifest.json` owns all plugin metadata, stylesheet entries, and the
shared runtime file list. `plugins/package.json` provides the single plugin
version. Builds generate
an Obsidian-compatible manifest for each plugin in `dist/plugins/<id>/`, using
the shared version. Per-plugin source manifests, `package.psd1`, `versions.json`,
and the legacy deployment guard are no longer used. The theme retains its own
manifest and packaging metadata. No plugin imports a sibling plugin.
Install.ps1 contains the shared packaging and installation helpers. The theme
has no imports from `plugins/`. Shared appearance values use standard Obsidian
CSS variables, with optional Patchwork values and native fallbacks.

Claudian is a separately installed upstream plugin. This repository maintains
its companion without patching the upstream installation. Patchwork Editor is
an independent Power Editor fork incorporating the former code-block plugin.
Code Editor handles standalone code files. All plugins share the root npm
dependencies but have independent installed entry points.

| Source directory | Installed plugin ID | Ownership |
| --- | --- | --- |
| `borders` | `patchwork-borders` | Window chrome, panel geometry, settings slots and document status |
| `project` | `patchwork-project` | File tree, search, selection, presets and semantic file-menu contributions |
| `git` | `patchwork-git` | Commit, Log, Diff, branch header/popup, repository commands and Git file actions |
| `terminal` | `patchwork-terminal` | Terminal sessions, tabs and xterm rendering |
| `claudian` | `claudian-extension` | Claudian integration only |
| `content` | `patchwork-power-editor` | Unified formatting, code cards, titles, history, navigation and outline |
| `content/code-editor` | `code-editor` | Standalone SQL, PowerShell and text-file editing |

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
```

Set `VaultPath` in `scripts1` to the absolute Obsidian vault path
on this computer. Both the installer and the standalone Claudian identity
checker read this shared configuration relative to their script directory.
Set `ObsidianCliPath` in the same file to the installed `Obsidian.com` path.
When moving to another computer, update this one file.

Run the script from the repository root:

```powershell
& .\scripts\Build-Install.ps1
```

It calls each plugin installer sequentially: Borders, Project, Content, Git, Terminal,
Claudian Extension, then Code Editor. Each plugin is compiled, installed and reloaded
before the next starts. Themes are installed only with `-ThemeOnly`.
The npm entry point performs the same workflow:

```powershell
# From the repository root: build, install and reload every plugin.
npm run build

# From the plugins directory: build and install every plugin, without themes.
npm run build

# Temporarily override the shared vault path for this invocation.
npm run build -- -VaultPath 'E:/Notes'

# Compile, install and reload only one plugin or a selected batch.
npm run build -- -Plugin content
npm run build -- -Plugin content,code-editor

# Build and install only the theme.
npm run build -- -ThemeOnly
```

For targeted development, use:

```powershell
pwsh -NoProfile -File scripts/Reload-Plugins.ps1 -Plugin project
pwsh -NoProfile -File scripts/Reload-Plugins.ps1 -Plugin 'project,git' -WhatIf
```

`Install.ps1` defines one installer function per plugin and retains the shared
backup, verified-copy, rollback and reload logic. `Build-Install.ps1` calls these
functions in the order above; `Reload-Plugins.ps1` calls only those selected by
name. Both target names and installed IDs are accepted, including comma-separated
batches. Unknown names are rejected before any plugin is processed. Compilation
receives only selected targets; shared type and boundary checks still inspect
the repository. `-WhatIf` performs selection only, without building or connecting
to Obsidian. Concurrent installation transactions from this checkout are rejected.
`-PluginsOnly` remains compatible with the full build entry point; `-ThemeOnly`
cannot be combined with plugin selection. Targets are defined in
`plugins/manifest.json` and checked against the managed plugin allowlist.

Output:

```text
dist/obsidian-patchwork/
  LICENSE
  themes/Patchwork/{manifest.json,theme.css,.patchwork-files.json}
  plugins/<plugin-id>/{manifest.json,main.js,styles.css,LICENSE,.patchwork-files.json}
```

`dist/plugins` holds intermediate plugin bundles. Installation reads only from
`dist/obsidian-patchwork` at the repository root. All selected artifacts and
destinations are validated before any running plugin is disabled. Copied files
are verified with SHA-256. Selected plugins are unloaded and their current and
previously owned runtime files are removed before copying the new files. Plugin
installation and cleanup are restricted to `patchwork-borders`, `patchwork-project`, `patchwork-git`,
`patchwork-power-editor`, `patchwork-terminal`, `code-editor`, and `claudian-extension`. Claudian
(`realclaudian` or `claudian`) and other third-party plugins are never cleanup
targets. Settings,
unknown user files and unrelated packages are preserved. Existing enabled states
are preserved; newly installed packages stay disabled by default. A failed build
stops before installation. Each plugin replacement is staged and backed up independently; installation/reload
failures restore that plugin's previous runtime and enabled state, stop the sequence,
and leave earlier successful plugins installed. If rollback itself fails, the error identifies the retained recovery backup.

`-MigrateModules` is rejected by these entry points so selected deployment cannot
expand into unrelated modules. `data.json` is never replaced by runtime installation.

Keep the target vault open and enable **Settings > General > Advanced > Command
line interface**. The script verifies the connected vault before copying files.
Use `-ObsidianCliPath` for a custom CLI path. For manual reload, disable affected
plugins first, pass `-SkipReload`, then enable only the
plugins that you need afterwards. Enabled selected plugins are rejected with
`-SkipReload` because their safe unload cannot be verified. Theme CSS reloads
through Obsidian's file watcher; installation never changes the active theme.

Claudian identity maintenance is a separate explicit action. Package installation
never patches or reloads the upstream Claudian plugin. The standalone checker
backs up its bundle before changing the Codex client identity and launch
environment. Its compatibility result still requires a real request to verify.
To request this maintenance after a Claudian update, run:

```powershell
& .\scripts\Repair-ClaudianCodexIdentity.ps1 -Reload
```

The standalone repair requires PowerShell 7. With `-Reload`, it reuses the
installer's CLI helpers without compiling or installing project packages.
Without `-Reload`, restart Obsidian manually, even if the file was already correct.
The file check and reload do not establish upstream access; verify with a real
Claudian message. They never send an AI request automatically.
The checker also accepts `-ClientName codex_vscode` when that identity is
required by your endpoint; the installer uses the default `codex_cli_rs`.

Installation is sequential rather than transactional. If copying or reloading
fails, correct the error and rerun the command before enabling a partially copied
plugin. No dependencies are installed automatically.

## Migration to the unified editor

Deploy `patchwork-power-editor`, and manually disable the old `powereditor`,
`patchwork-code-blocks`, Awesome Format Bar and its style companion. The installer
does not clean these legacy plugins. Do not enable
the old editors alongside the fusion. The former `note-code-blocks` source is
now part of `plugins/content/src/editor`, not a second plugin.

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

The current Patchwork theme uses `themes/Patchwork/patchwork.css`, derived from
GitHub Theme. Previous Maple theme modules and bundled Maple Mono fonts are no
longer included. Historical copyright notices remain in the root license;
third-party dependency licenses inside ignored `node_modules` belong to those
dependencies and are not removed.

## Unified plugin project

All dependencies and the single lockfile are managed at the repository root;
run dependency installation there to populate the root `node_modules` directory.
TypeScript configuration remains in `plugins/tsconfig.json`. All plugins use
the version in `plugins/package.json`, which contains only metadata and command
entry points. The root npm project provides plugin and theme dependencies, the
combined build-and-install command, and `npm run typecheck`.
