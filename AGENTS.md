# Development Rules

## Scope and authorization

- Change only code directly related to the requested task. Preserve unrelated working-tree changes, including icon edits and pending moves.
- Prefer the existing structure, naming, dependencies, UI patterns and code style. Avoid speculative abstractions, unrelated formatting and broad refactors.
- Do not install development tools, change machine configuration, or add or modify tests without explicit user authorization. Plugin builds are authorized only within the targeted completion workflow below. Reuse declared dependencies. Explain a necessary new runtime dependency before introducing it.
- The targeted completion workflow below provides standing authorization to build, install and reload plugins modified by the current task, including development sessions running in IDEA. Application restarts, theme deployment and deployment of unrelated plugins still require explicit user authorization.
- Read-only inspection and relevant syntax or type checks are appropriate for code changes. Report exactly which checks ran; do not claim a runtime fix from static checks alone.
- Do not force-stop Obsidian without authorization: unsaved work can be lost. Back up affected installed files before deployment.
- All new or modified documentation, including filenames, headings and frontmatter, must be English unless the user explicitly requests another language.
- Do not create commits, reset the working tree, discard changes or publish work unless requested.

## Module ownership

This is a multi-plugin project. Source nesting does not imply a shared installed plugin.

| Source | Installed ID | Responsibility |
| --- | --- | --- |
| `plugins/borders` | `patchwork-borders` | Window chrome, rails, native dock geometry, generic panel hosts, header/settings slots and footer presentation |
| `plugins/project` | `patchwork-project` | File explorer, search, selection, rename, file menus and explorer Git-status presentation |
| `plugins/git` | `patchwork-git` | Repository operations, Commit, Log, Diff, branch header and Git-specific menus |
| `plugins/terminal` | `patchwork-terminal` | Terminal sessions, process lifetime, tabs and xterm rendering |
| `plugins/claudian` | `claudian-extension` | Companion UI and capability adapters for the separately installed upstream Claudian plugin |
| `plugins/content` | `patchwork-power-editor` | Markdown editing, formatting, code cards, titles, navigation, history, outline, attachments, document state and file encoding |
| `plugins/content/code-editor` | `code-editor` | Independent editor for standalone code and text files |
| `themes/Patchwork` | Theme: `Patchwork` | Native application appearance, shared defaults and tokens |

- `plugins/contracts` contains type-only public contracts. Do not put executable implementation code or runtime initialization there.
- `plugins/utils` contains genuinely shared infrastructure, not business implementations or feature-owned CSS. Other utilities belong in their owning module's `utils` directory.
- Never import another plugin's implementation, even through a relative path into the nested Code Editor directory.
- Communicate through the per-App, versioned registry in `plugins/utils/service-registry.ts` and contracts in `plugins/contracts`.
- Never resolve a Patchwork sibling through installed plugin IDs, private plugin instances or another feature's DOM. Use public services and explicit registration handles.
- Git History is a capability source only. Keep Patchwork's existing Git Log, Commit and Diff presentation; do not copy upstream views, styles, toolbars or plugin lifecycle. Adapt its backend and graph/diff algorithms behind the existing controls. The separate history-view integration is deferred.
- Infrastructure imports must be inert. Initialize services during plugin load and unregister them on unload.
- Features must tolerate missing optional services, disabled providers, provider replacement and arbitrary plugin load order. Return explicit unavailable errors instead of silently performing unrelated fallback actions.
- Borders owns layout and mounting only. Keep terminal processes, Git operations, editor mutations and Claudian presentation behavior in their respective modules.
- Claudian Extension does not supply the upstream chat implementation. Discover upstream capabilities through named adapters under `plugins/claudian/src/integrations`; do not patch upstream installed files or depend on its installation ID.
- Do not reintroduce legacy `power-editor`, top-level `code-editor`, `claudian-extension`, or Content-owned Terminal/Git panel implementations.
- Treat the current source tree and manifest as the source of truth. If older README migration links point to missing `docs` files, report that fact; do not invent plan contents, migration baselines or completed acceptance results.

## State, windows and lifetime

- Use `WindowContext` and `CallContext` when crossing module boundaries. Validate the document, window ID, leaf ID, file path and cancellation signal before and after asynchronous operations.
- Preserve the invoking window and document group. Do not fall back to a main-window editor when a popout target disappears.
- Publish plain snapshots, not live editor objects or DOM internals. Keep CodeMirror access inside the owning editor or its explicit adapter.
- Never publish decrypted encrypted-note contents through global snapshots or selection broadcasts. Meld Encrypt owns encrypted saving, passwords and locking; do not write plaintext to encrypted files.
- Register disposal immediately for listeners, subscriptions, observers, timers, animation frames, menus, node leases and processes.
- Restore a leased method, attribute, style or native node only when the current value still belongs to that lease. Never overwrite another plugin's replacement during cleanup.
- A hidden Terminal may retain sessions; disabling or removing its owner must dispose them.
- Keep settings migrations retryable and preserve donor data, unknown keys and markers. Do not replace a whole shared settings object with a stale copy.
- Preserve existing enabled/disabled states and user data during deployment. New modules are disabled by default unless the current session explicitly authorizes migration.

## DOM, layout and interaction pitfalls

- Native views do not all expose `contentEl`. When resolving a native panel host, prefer the view's `contentEl` and fall back to its own `containerEl`; do not inspect feature-specific child elements or move native content.
- Make repeated synchronization idempotent: write attributes, text, styles and node positions only when they actually differ.
- Never repeatedly append an already-positioned rail button. A capture-phase `pointerdown` or `focusin` sync can detach/reinsert the pressed node and suppress the subsequent native click. Preserve identity and position while interacting.
- Never combine broad MutationObserver callbacks, unconditional DOM writes and a self-rescheduling microtask loop. This previously froze Obsidian and prevented CLI replies.
- In particular, rewriting the same vault badge `textContent` still creates child-list mutations. Compare the text before writing.
- Coalesce layout work with an animation frame, yield to input and painting, and cancel pending work on unload. A frame scheduler does not replace idempotent DOM updates.
- Narrow observers to the required roots and mutation types. Avoid global ownership observers or repeated geometry reads mixed with unnecessary writes.
- Check that a target exists before restoring it. `undefined === undefined` can make an optional-chain comparison pass and then cause an assignment to an undefined settings tab.
- Do not create Zen presentation while a native sidebar is still collapsing. The Claudian compatibility adapter defers upstream activation until the dock has actually finished hiding; do not replace this with an arbitrary timeout.
- Cancel deferred presentation work when the sidebar reopens, the provider changes or the companion unloads. Keep the upstream enable setting unchanged and restore all leased hooks.
- Expanded dock width limits must not clamp a collapsing dock. Release its CSS minimum width during collapse and do not resize the logical dock while its native collapse animation runs.
- Zen starts translucent. Hover or explicit pointer/keyboard activation makes it opaque; an outside pointer interaction removes the active state. Keep opacity changes compositor-friendly and honor reduced-motion preferences.
- Scope and initialize a new Zen portal synchronously before its first paint. A periodic compatibility scan alone can cause a fully opaque flash before the translucent style is applied; enable opacity transitions after resolving the initial style.
- Verify real pointer press/release sequences. Programmatic `.click()` alone missed the rail-button regression.

## Styles and icons

- Keep feature styles with their owners. The theme must not style community-plugin interiors or contain feature implementations.
- Scope feature roots and detached menus/dialogs with `data-pw-module`. Feature selectors must exclude nested roots owned by another module.
- Borders may select native wrappers and its own controls; it must not reach into Claudian messages/composer, Git panel interiors, terminal contents or CodeMirror internals.
- Tag detached portals at creation and release their scopes when closed. Use the existing Obsidian menu and dialog patterns. Reuse established styles; any new visual treatment should remain consistent with the project.
- Keep native controls' listeners and restore their original position and artwork on unload. Do not clone interactive controls as a substitute for leasing them.
- Register module-namespaced icons through existing icon utilities. Do not globally replace Obsidian icons.
- Preserve original SVG geometry, paint, padding and attribution. Do not normalize the icon collection as an incidental cleanup.
- Keep xterm styles inside Terminal's local ShadowRoot. Measurement probes must use the same rendering root as the terminal.

## File encoding

- Borders owns the status-bar button and encoding menu. Content owns conversion, filesystem access, persistence and subsequent-save behavior through `ContentApi.setEncoding`.
- Opening the menu must not convert or switch a file. Convert only the captured document after an explicit user choice, and reject stale document/window targets.
- Supported choices are UTF-8, UTF-8 BOM, UTF-16 LE/BE, GBK, GB2312 and ASCII. Preserve later saves in the chosen encoding; changing the label alone is insufficient.
- Never silently replace unrepresentable characters with `?`. Check encode/decode round trips, validate the requested character set, and reject lossy or ambiguous conversions.
- Preserve read-only and encrypted-note protection. Flush pending editor saves, prevent concurrent editing during conversion, revalidate disk contents and retain original-byte backups.
- File-specific adapter leases must leave unrelated files alone. Serialize writes and read-modify-write appends per encoded file so concurrent operations cannot lose content.
- Persist selections in the owning plugin's `file-encodings.json`, update paths on rename/delete, and preserve that file and `encoding-backups` during installation.
- Non-UTF-8 read/write support requires Patchwork Editor to remain enabled. Make this requirement visible in the UI; do not silently convert files during unload.
- Validate with disposable files only unless the user specifically requests changing an existing file. Clean up only the temporary files and backups created by the validation.

## Packaging and validation

### Completion build, installation and reload workflow

- Complete plugin development in this order: modify source, run relevant checks, build, install, then reload the modified plugin. This workflow is standing authorization; do not ask separately for build, installation or targeted reload permission.
- Select only plugins whose source or runtime assets this agent changed for the current task, using target names from `plugins/manifest.json`. For a Project-only change, select `project`; for a Git-only change, select `git`. Use a comma-separated list only when this task actually modifies multiple plugins. Never derive the deployment scope from all dirty files in the shared workspace or include plugins being developed by unrelated sessions.
- Run `pwsh -NoProfile -File scripts/Reload-Plugins.ps1 -Plugin '<modified-targets>'` to compile, install and reload only the selected plugins. Always supply an explicit, nonempty `-Plugin` selection. Do not omit it, use the all-plugin `-PluginsOnly` option, or add `-MigrateModules` to widen deployment. Do not install the theme as part of plugin-only work.
- Only explicitly selected plugins are compiled, packaged, installed and reloaded. Shared type and module-boundary checks may inspect the whole repository without compiling unrelated plugins. The full `Build-Install.ps1` entry point invokes all seven plugin functions sequentially and must not be used without a selection during targeted development. Shared infrastructure changes require identifying the plugins affected by this task; do not automatically select every consumer.
- Use the build/install script's existing backup, verified-copy and reload lifecycle. Preserve settings, user data and previous enabled states. Disabled plugins remain disabled; report them rather than enabling them. `claudian` means the companion `claudian-extension`, not the upstream chat plugin.
- Both entry points call the per-plugin functions in `scripts/Install.ps1`, which owns compilation, backup, installation, verification and reload. Successful installation includes loading and verifying the new runtime; do not reload it a second time unnecessarily.
- Skip build, installation and reload for documentation-only changes. If deployment or reload would interrupt known active work, such as Terminal processes or an in-progress operation, defer the affected target and report why. Keep Obsidian open; never force-stop it.
- Both entry points support `-WhatIf` to inspect scope without compiling, changing files or connecting to Obsidian. Installation transactions are serialized per checkout with a named mutex. If another deployment is running, retry after it finishes. On timeout, inspect application state before retrying because the in-app operation may still be running.
- Verify installed bytes against the intended output and confirm the selected previously enabled plugins loaded successfully. Report built, installed and reloaded targets, disabled targets, deferred targets and failures. If deployment fails or is deferred, explicitly state that the source changes are not yet live. A successful reload confirms lifecycle completion, not visual or functional acceptance.

### Build and deployment

- `plugins/manifest.json` owns plugin targets, source paths, installed IDs, style entries and runtime-file lists. `plugins/package.json` owns the shared plugin version; the root `package.json` owns npm dependencies.
- Each plugin produces its own `main.js`, `styles.css`, `manifest.json` and license. `dist/plugins/<id>` contains build outputs; `dist/obsidian-patchwork` contains installer packages.
- Never fix generated `dist` files or installed bundles as the primary implementation. Change source and use the authorized build/deployment path.
- Run `node plugins/scripts/check-module-boundaries.mjs` for ownership, reference and CSS changes. Use `npm run typecheck` and `node --check <file>` as relevant; TypeScript currently does not type-check JavaScript bodies.
- Follow the targeted completion workflow above for plugin builds and deployment. Always pass only the current task's modified plugin targets to `scripts/Reload-Plugins.ps1 -Plugin`. Keep destination/profile configuration isolated in `scripts/Deployment.psd1`.
- Verify that installed bytes match the intended output and confirm the plugin is enabled. Source checks alone do not prove a deployed runtime is fixed.
- For interaction changes, check console errors, physical clicks, repeated toggles, provider disable/re-enable, animation completion and UI responsiveness. Add tests only with authorization.
- CLI calls use the configured `Obsidian.com`. A discovery failure may indicate sandbox/IPC isolation even when Obsidian is open; investigate permissions before concluding the application is closed.
- `dev:console` requires `dev:debug on`. Inspect captured errors, use bounded CLI calls, and detach debugging when finished. Do not leave indefinitely blocked CLI processes behind.
- Do not log note contents, secrets, credentials or decrypted text while diagnosing user files.
- Delete only confirmed empty directories, with a fresh emptiness check. Do not recurse into `.git`, dependencies, generated outputs, IDE/application state or linked directories for source cleanup.

## Implementation conventions

- Separate imports from use; avoid inline fully qualified names. Do not introduce nested classes or handwritten builder classes. Keep responsibilities focused and prefer guard clauses.
- Use strategies or composition for genuinely extensible multi-type flows rather than large conditional trees. Avoid adding abstractions for trivial differences.
- Avoid duplication, incidental memory retention and unnecessary collection work. Prefer expressive collection operations when they remain readable and efficient.
- Do not hardcode secrets. Use profiles for environment-specific database configuration and distinct filenames for initialization versus incremental scripts.
- For Java work, use Lombok for ordinary DTOs/configuration and `@Data` for JPA entities as applicable. Reuse parent-managed dependencies. Use `Objects` for object null checks, `StringUtils` for blank checks, collection utilities for empty checks, and `Strings.CS.equals` / `Strings.CI.equals` from Apache Commons Lang for string equality. Prefer `Optional` for optional business results. These Java conventions do not require adding Java dependencies to this TypeScript project.
