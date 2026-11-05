# Git Interface Reference

## Reference baseline

The Commit and Git Log interfaces are compared against JetBrains
`intellij-community` revision `8eee455aa813af4ad427fd576b0ad8d94c418577`.
This is a pinned source reference, not a claim that every IDEA release or
customized installation uses the same toolbar configuration.

The local IntelliJ IDEA 2026.2 `NotRoamableUiSettings` specifies
Microsoft YaHei UI at size 12. Git interface typography follows those values;
code rendering retains the editor monospace font. The dark palette follows
Islands Dark. Swing device scaling and Electron CSS pixels may differ.

## Source-to-interface mapping

All paths below are relative to
[the pinned repository](https://github.com/JetBrains/intellij-community/tree/8eee455aa813af4ad427fd576b0ad8d94c418577).

| Source | Relevant behavior | Patchwork implementation |
| --- | --- | --- |
| `platform/vcs-log/impl/src/com/intellij/vcs/log/ui/frame/MainFrame.java` | Two `OnePixelSplitter` instances separate history, changed files and commit details. | One-pixel visible dividers with wider transparent pointer hit areas. |
| `platform/vcs-impl/resources/META-INF/VcsActions.xml` | Changes toolbar orders Refresh, commit UI actions, Rollback, Diff, Changelists and Shelve. | Existing Commit view omits redundant commit-view toggles; Changelists is restored. Stage/Unstage are extensions visible only in staged mode. |
| `platform/vcs-impl/shared/resources/intellij.platform.vcs.impl.shared.xml` | Shared Changes toolbar uses `AllIcons.Actions.Show`, followed by selection and expansion actions. | Use the normal Show artwork, without inspection-eye scaling or stroke overrides. |
| `platform/vcs-impl/src/com/intellij/vcs/commit/ChangesViewCommitPanel.kt` | Included changes and selected changes are separate concepts. | Checkboxes determine checked-file commit inclusion; row selection determines toolbar actions. |
| `platform/vcs-impl/src/com/intellij/vcs/commit/CommitActionsPanel.kt` | Commit executors and commit options are separate controls. | Commit remains the stable button label; scope is explicit above the editor. |
| `plugins/git4idea/backend/src/ui/branch/dashboard/BranchesDashboardTreeComponent.kt` | Branch toolbar order and settings placement. | Directory grouping is inside branch settings, rather than an extra toolbar button. |
| `plugins/git4idea/backend/src/ui/branch/dashboard/BranchesDashboardActions.kt` | Update is hidden without remotes and requires tracking. Delete rejects the current branch. My Branches requires a complete author index. | Selection-dependent state is refreshed on branch/group changes. Remote deletion remains confirmed and leased. My Branches computes nonempty exclusive commit sets and requires every exclusive commit to match the current canonical email. |
| `platform/vcs-log/impl/resources/intellij.platform.vcs.log.impl.xml` | Log presentation settings, changed-file presentation settings and branch settings are separate groups. | Log settings control author/date columns and commit details; branch settings control tags and directory grouping. |
| `platform/vcs-log/impl/src/com/intellij/vcs/log/ui/frame/VcsLogChangesBrowser.kt` | Changed-file toolbar uses the main toolbar as its height reference. | Both toolbars align at 42 CSS pixels. |

## Explicit integration differences

- Patchwork uses Obsidian menus and dialogs, not Swing components.
- Existing namespaced JetBrains SVG assets retain their source geometry and paint.
  CSS must not reshape paths or clip the artwork to imitate a different icon.
- Checked-file commits and staged-index commits remain explicit modes. Row
  selection must never silently change checkbox inclusion.
- Some repository operations remain unavailable in popout windows; controls must
  reflect the actual capability rather than fall back to a main-window target.
- Patchwork computes branch ownership on demand; it has no remote branch-protection service,
  or IDEA commit-check extensions. These are not represented as supported parity.
- Borders owns native window rails and outer tool-window hosts. Git styles apply
  only inside Git-owned roots, menus and dialogs.

## Branch icon provenance

`GitBranchesTreeIconProvider.kt` under `plugins/git4idea/shared/src/com/intellij/vcs/git/ui`
selects current, current-and-favorite, favorite, ordinary branch and tag artwork
separately. The three files under `icons/idea/dvcs` come unchanged from
`platform/dvcs-impl/shared/resources/icons/new` at the pinned revision above.
Their original Apache 2.0 copyright notices remain in the SVG files. Ordinary
branches use the new UI `expui/general/vcs_dark.svg` through the existing
`git-branch-flipped` alias; favorites use `expui/nodes/star_dark.svg`.

## New UI icon mapping audit

The audit follows Action definitions through `platform/icons/src/PlatformIconMappings.json`
and then resolves the dark SVG variant at the pinned revision. Comparing an old
SVG against its original source alone does not validate the new UI mapping.
Thirty-three existing action assets were compared against their recorded official
paths, ignoring only line endings and surrounding whitespace; all matched.

| Control | Official mapping | Resolution |
| --- | --- | --- |
| Commit and Git tool-window entry | ToolWindowCommit / ToolWindowChanges | `expui/toolwindows/commit_dark.svg` / `vcs_dark.svg`, registered by Git before passing IDs to Borders |
| Commit options and branch settings | GearPlain | `expui/general/settings_dark.svg` |
| Log tab close and tool-window hide | CloseSmall / HideToolWindow | Existing new UI close and hide assets replace generic Lucide artwork inside the Git-owned tab host |
| Commit message history | Vcs.History, HistoryInline, HistoryInlineHovered | All map to `expui/general/history_dark.svg` |
| Ordinary branch | Vcs.BranchNode | `expui/general/vcs_dark.svg` |
| Favorite | Nodes.Favorite | `expui/nodes/star_dark.svg` |
| Show My Branches and Go to Hash or Reference | Actions.Find | `expui/general/search_dark.svg`; existing artwork retained |
| View Options | Actions.Show / Actions.GroupBy | Both map to `expui/general/show_dark.svg`; existing artwork retained |
| Refresh, add, delete, update, fetch, diff, rollback, shelve, locate, expand/collapse | Corresponding Action and VCS mappings | Existing new UI assets retained |

Toolbar and tree SVGs retain their native 16-pixel canvas instead of arbitrary
13–15-pixel scaling; the settings icon is no longer enlarged to 18 pixels.

Log reference markers now adapt the new-UI geometry and overlap masking from
`LabelIcon.java` and `TagPainter.kt` under `platform/vcs-log/impl/src/com/intellij/vcs/log/ui/render`.
They are not ordinary branch-tree icons. Colors follow GitRefManager named colors
and the dark platform palette: HEAD yellow, local branch green, remote purple,
and tag gray. Hover and selection supply the label background. Patchwork still
uses its compact reference-name grouping; this is not the full IDEA configurable
reference-group renderer or support for user-customized IDEA palette overrides.

## Validation of the mapping corrections

Type checking, JavaScript syntax checking and module-boundary checks passed.
Only the Git plugin was built, installed and reloaded. All five installed runtime
files matched the final installer package; intermediate main.js differs because
the packaging step prepends the root license notice.

Runtime inspection verified namespaced tool-window artwork, no missing toolbar
SVGs, and 16-by-16-pixel Log toolbar/tree icons after preventing flex shrink.
Physical mouse press/release opened the panels and selected a history row.
Reference labels use the row selection background; hover masking uses an opaque
composite so overlapping outlines do not accumulate translucent paint.
No errors were captured during the checks, and the debugger was detached.
These checks cover the corrected controls, not every IDEA dialog or action state.

## My Branches and action availability

`BranchesDashboardUtil.kt` defines a personal branch as a branch with a nonempty
exclusive commit set whose authors are all the current user. `DataPackUtil.kt`
and `graph/utils/GraphUtil.kt` implement the branch-head boundaries and reject
nodes reached from outside the exclusive subgraph. Patchwork now reads the full
local branch, remote and tag graph in topological order and propagates ownership
with the same head boundaries. References sharing a tip share the result.
Repository-specific `user.email` and Git mailmap determine the canonical author
identity. IDEA user-name alias expansion is not implemented.

The filter is cancellable and recomputed when the active Log refreshes. Root
changes, unload, changing references, shallow history and missing identity do
not publish partial results. Git process timeout/output limits remain explicit
errors rather than silently limiting history. Both local and remote branches
are filtered. Empty results are explained in the branch pane.

Unimplemented Local History placeholder entries were removed; this does not
implement IDEA Local History. Stage/Unstage entries follow staged mode. Branch
and history mutation menus reflect active operations and window capabilities.
Push/Update require a valid preview and invalidate it on destination changes;
Update requires the current branch and can save/restore local changes, including
their staged state. Conflict recovery retains the saved stash. Interactive Rebase requires
a valid nonempty range, clean worktree and valid first retained action/message.
Execution-time checks still revalidate repository state.

## High-frequency workflow completion

The comparison inventory records the checked high-frequency scope. Staged mode
now has independent staged/unstaged groups and an explicit Commit All toggle.
The toggle follows `GitStageCommitWorkflow.kt`: tracked changes are included,
unversioned files are excluded, and Amend keeps staged semantics. Each side
opens its corresponding Diff and exposes only applicable staging actions.

Push previews preserve the selected commit and expose both transfer directions
with pagination. Tracking replacement is explicit. Update saves local changes
in an identifiable stash and restores the index; failed or conflicting restores
retain recovery data. Git's internal stash pathspec processing must not inherit
`GIT_LITERAL_PATHSPECS=1` when saving untracked files.

Content and standalone Code Editor own their changed-line gutters and undoable
rollback. They request ordinary UTF-8 HEAD baselines through the public Git
contract, reject stale/read-only targets and exclude encrypted or binary files.
No editor contents are published through Git snapshots. Shared text replacement
calculation is inert and does not import another plugin's implementation.

Commit layout/grouping, Log tabs/filters and Diff presentation are persisted.
Native Obsidian command bindings remain user-configurable; scoped shortcuts do
not replace the application's global keymap. Islands values and official SVG
geometry remain the source baseline, with normal Swing/Electron scaling differences.

Native ItemView keyboard `scope` remains owned by Obsidian. Commit and Diff
store their CSS ownership lease in `moduleScope`; replacing the native field
causes the application key handler to call a missing `handleKey` method.

Validation included in-memory graph cases for mixed authors, same-tip aliases,
merged branches, merge ancestry, tagged descendants, shallow history and abort.
An isolated temporary bare Git repository confirmed the real command sequence
includes owned local/remote branches and rejects a mixed-author branch. No test
files were added and no user repository history was modified.

## Local branch protection and pre-commit checks

`GitSharedSettings.java` defines protected branch patterns, defaulting to master
and main. `GitProtectedBranches.kt` matches remote-operation branch names without
the remote prefix. `BranchesDashboardActions.DeleteBranchAction` rejects current
local branches and protected remote branches. Patchwork now applies the local
rule portion in toolbar/menu state and again before remote deletion. Rules are
saved per repository in Git preferences; expressions use JavaScript RegExp with
full-name matching, not every Java-specific regex extension. Empty rules are an
explicit override. Invalid persisted rules fail closed. Server-side protection
synchronization and provider-specific authentication are not implemented.

Commit Options offers an optional whitespace/conflict-marker check, disabled by
default. `git diff --cached --check` inspects the real index for staged commits
and the prepared private index for checked-file commits. It checks newly staged
changes, not historical whitespace in an unchanged amended commit. Git hooks
and signing remain enabled. Repository/HEAD changes across confirmation dialogs
abort the commit. This does not implement IDEA code inspections or formatting.

Tag creation requires a name/revision; remote tag controls require a destination.
Worktree creation requires directory/branch/revision, and locked worktrees cannot
be removed from the dialog. Stash creation requires changes without conflicts.
Reset requires a target and loaded repository state; Hard reset is unavailable
with local modifications. Execution-time checks remain authoritative.

The isolated Git validation confirmed that whitespace checks ignore unstaged
content in staged mode, reject bad checked-file content in the private index,
preserve unrelated staging, release the index lock and create no commit on
failure. Branch-rule checks covered defaults, full matching, remote-prefix
resolution and an explicitly empty rule set. Runtime inspection confirmed the
protected origin/main delete state, empty Tag/Worktree inputs, and dirty-worktree
Hard Reset state. Static checks and final package hash verification passed; only
Git was deployed and no console errors were captured.

## Dialog and branch-popup follow-up

Additional references at the same pinned JetBrains revision:

- `plugins/git4idea/backend/src/reset/GitNewResetDialog.kt`: reset modes use radio buttons with descriptive comments.
- `plugins/git4idea/backend/src/rebase/interactive/dialog/GitInteractiveRebaseDialog.kt` and `ChangeEntryStateActions.kt`: commit table, top action toolbar, move actions and Stop to Edit.
- `plugins/git4idea/backend/src/ui/GitTagDialog.java`: duplicate names disable creation until Force is selected; Force is unavailable for a new name. The form supports a multiline annotation.
- `plugins/git4idea/shared/src/com/intellij/vcs/git/branch/popup/GitBranchesPopupBase.kt` and `GitBranchesPopupHeaderActions.kt`: persist user dimensions and enable Restore Popup Size only after resizing.

Task dialogs now separate auxiliary actions from Cancel and primary actions, keep
footer actions outside the scrolling body, and block body interaction while an
async action is pending. Clone retains explicit cancellation. Compare invalidates
Open Diff Tab when revision inputs change or loading fails. Clone, repository,
tag and worktree fields expose prerequisite-based disabled states.

Rebase reads full commit messages, including bodies and trailers. It uses a commit
table, selected-row action control, official moveUp/moveDown SVGs and a multiline
message editor. Stop to Edit uses native Git state; a dedicated Commit action
amends all staged changes only at an edit stop, then Continue/Abort remains
separate. Ordinary partial commits during active operations remain prohibited.
Rebase supports Ctrl/Cmd and Shift multi-selection, keyboard selection, moving
selected rows, combining selected commits and editing the combined squash message.
Fixup excludes its own message. Reset Actions restores the original plan.
Merge-containing ranges use native `--rebase-merges`, retaining label/reset/merge
instructions. Merge commits support Pick and Reword; ordinary commits additionally
support Edit and Drop. Reordering and combining are disabled in this mode to avoid
silently changing topology. This is not full parity with IDEA's graph editing UI.
Hard Reset still requires a clean worktree in
Patchwork, which is intentionally stricter than IDEA's destructive reset flow.

Branch popups support pointer and keyboard resizing, persisted dimensions and
restoration. The current/favorite icons use the same official provider mapping
as Log. Legacy CSS mirroring, 14/15-pixel SVG sizing, artificial brightness filters
and the extra one-pixel menu font reduction were removed from these surfaces.
The header chevron uses the official SVG instead of CSS borders. Existing source
SVG geometry and attribution remain unchanged.

Validation used disposable repositories without adding test files: multiline
Reword preservation, Edit/amend/Continue, stale operation rejection, retained
backup refs and unstaged files, representative native reference-name validation,
multiline annotated tags, conditional Force and stale-tag rejection. Physical
pointer sequences verified Reset mode state, Rebase row movement, popup resizing,
reopening with saved dimensions and restoring the default size. These checks do
not claim pixel-for-pixel acceptance against a running IDEA installation.

## Interactive rebase completion

The same pinned upstream `GitRebaseDialog.kt` confirms interactive merge-preserving
rebase support. `ChangeEntryStateActions.kt` maps Pick to Actions.Rollback and Edit
to Actions.Pause. `PlatformIconMappings.json` resolves these to `expui/vcs/revert`
and `expui/run/pause`; the latter dark SVG is bundled unchanged with its JetBrains
Apache-2.0 copyright header. `VcsActions.xml` maps shelf restoration to Vcs.Unshelve,
resolved to the existing `expui/vcs/unshelve_dark.svg`. Shelf navigation uses the
existing Shelve icon as a Patchwork integration choice.

Disposable real repositories verified multi-row order, full message bodies and
trailers, custom squash messages, Fixup message exclusion, backup refs, unchanged
final trees and retained two-parent merges. A failing amendment hook left a
rescheduled exec command, and native Continue applied the intended message after
the hook was released. Actual pointer presses verified range selection, disabled
Reword for multiple rows, Squash and Reset Actions without rewriting user history.
Commit subject buttons explicitly align their flex content to the left, avoiding
Obsidian's inherited button centering.

## Unstaged file and directory moves

### Observed vault operations

Upstream references at revision `8eee455aa813af4ad427fd576b0ad8d94c418577`:
`platform/vcs-impl/src/com/intellij/openapi/vcs/VcsVFSListener.java` expands directory
moves; `plugins/git4idea/backend/src/vfs/GitVFSListener.java` updates added and removed
index paths, subject to staging/add/remove settings, and handles case-only moves;
`plugins/git4idea/backend/src/util/GitFileUtils.kt` supplies the add/remove commands;
`plugins/git4idea/backend/src/status/GitChangesCollector.java` reports renames as
`FileStatus.MODIFIED` using old and new content revisions.

Patchwork now listens to vault rename events and batches their real old/new paths.
Tracked descendants follow chained directory moves; untracked descendants remain
untracked. Observed moves automatically stage the destination content and remove
the old index entry, including any edits in the moved file, as the IDEA add/remove
flow does. Other staged and unstaged files remain unchanged. This integration does
not expose IDEA's full add/remove confirmation preferences.

Unlike IDEA's separate add/remove calls, Patchwork prepares a copied index under
the real index lock and atomically installs it only after validation. Case-only
moves remove the old index spelling before adding the destination with case-sensitive
index matching; the filesystem has already been renamed by Obsidian. Repeated and
chained events are coalesced. A newer move invalidates pending work and retries the
combined batch. Changelist assignments follow successfully moved tracked paths.
Checkout/active-operation events do not trigger indexing. Disabled/unready Git,
cross-repository moves, submodules, ignored destinations and conflicts are not
silently forced through. Failures retain the old index and report an error.

This applies to new observed operations. Earlier or external changes still use
the detection fallback below; installation does not automatically stage them.

### Detection fallback

Native status usually reports an unstaged move as a deletion plus an untracked
destination. Patchwork now compares those candidates using Git rename detection
in a disposable copy of the index. It does not stage files in the real index.
Detected moves retain both paths, use the modified filename color, and show the
original path in Commit. Project receives the same modified-state snapshot.
Folder moves are represented by their constituent file moves, as Git tracks
files rather than directory rename objects. Native staged rename detection is
explicitly enabled even when user status configuration disables it.

Working Diff and exported patches include destination contents through a private
index. Staging and checked-file commits include both paths. Shelving an unstaged
move requires staging it first; the menu and toolbar explain that prerequisite.
Detection uses Git's default similarity threshold, so a move accompanied by a
substantial rewrite can still be reported as a deletion and an addition. Conflicts
retain their raw status and are not paired into moves.

Disposable repository validation covered a folder move with edited text, binary
content and Unicode/spaced names; disabled Git rename configuration; unchanged
real-index bytes after status, diff and patch reads; stage/unstage; and committing
only moved paths while preserving unrelated staging and untracked files.
