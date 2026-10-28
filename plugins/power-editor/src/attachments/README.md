# Per-folder attachments

## Ownership and entry points

Patchwork Editor owns this module; no additional plugin or dependency is required.
`editor-runtime.js` installs `AttachmentManager`. The explorer's More options menu
and the `Review unreferenced images` command open the same review interface.
Core **Settings > Editor > Patchwork** exposes folder visibility, the review action,
and an action that sets the native attachment location to `./assets`.

The current vault is configured to use that native location. Obsidian creates each
folder on demand and retains its native conflict handling. The setting also applies
to other newly imported attachment types. Existing images, links, and directories
are not migrated. Links to existing images are not treated as imports.

## Visibility and search

`explorer-actions.js` filters exact-name `assets` folders from the native sorted tree.
It does not change vault indexing or filesystem attributes. Disabling the preference
or the plugin restores normal visibility. Full-text explorer search runs on demand
and does not store an index. Locked encrypted notes are searchable by filename only;
currently unlocked notes can be searched in memory. Unreadable text and text files
larger than 5 MiB are reported as skipped. Binary document formats are not searched.

## Reference analysis

Cleanup targets AVIF, BMP, GIF, JPEG/JPG, PNG, SVG and WebP files within exact-name
`assets` directory trees. Configuration, version-control, trash and named backup
directories are excluded as targets. Readable backup notes exposed by the active
vault still protect their references. Hidden native trash, Git history and compressed
archives are historical storage, not active reference sources; this tool cannot
guarantee that historical versions remain independently renderable after cleanup.

The scan requires clean native metadata before allowing cleanup. It combines native
resolved links with fresh metadata, reference-style definitions, Wiki links and embeds,
HTML image/link attributes and CSS URLs. Paths are resolved relative to their source
or through native link resolution, including encoded paths and duplicate filenames.
Saved content and live editor content are both checked. Plaintext is used only in
memory during analysis, never saved in an attachment database or search index.

Canvas file nodes, text-node references and group backgrounds are checked. Standard
Excalidraw JSON and Markdown Embedded Files mappings are checked. Compressed drawings
use the installed Excalidraw API to decode their scene without loading external images.
No decompressor is installed by this module. Unsupported mappings/custom data,
unavailable decompression, open drawing editors, unreadable documents, unresolved
image links, encrypted inline content or locked encrypted notes block cleanup globally.
Unlock encrypted notes and save/close drawing editors before retrying the scan.

## Review and deletion safety

Results are grouped by directory with paths, sizes, lazy thumbnails and selected/total
counts. SVG previews are opened only on request. Rows are loaded in batches of 100.
Nothing is selected initially. The user must select files and confirm the count/size.
Immediately before each selected file is moved, the complete vault is scanned again;
new references, changed/moved files and uncertain analysis cause a skip.

`vault.trash(file, false)` explicitly uses the recoverable vault-local `.trash`, even
if general deletion preferences request permanent deletion. Failure never falls back
to permanent deletion. Empty folders are retained. Successes, skips and failures are
reported separately. There is no scheduled cleanup, automatic deletion or migration.

## Validation

In-memory fixtures cover relative/encoded paths, same-named files, reference-style
links, Canvas, Excalidraw mappings, encrypted-note uncertainty, stale scans and trash
failure. Native attachment path generation and exact-name folder filtering are checked
without creating vault files. Running-vault checks cover the review dialog, disabled
cleanup for unresolved encrypted content, full-text filtering and lifecycle cleanup.
No user images are deleted as part of validation; actual clipboard/drop handling is
delegated to the unchanged native attachment workflow.
