# Patchwork Git

An independent desktop Git plugin with an IDEA-style commit tool window. It uses the existing `git` executable and does not require Obsidian Git or additional packages.

## Integration

The plugin target is `git`, registered in `../manifest.json`; the installed plugin ID remains `patchwork-git`. Its stylesheet entry is `styles/index.css`. Git owns Commit, Log, Diff and the branch header/popup. Borders places its registered panels and header slot. Project consumes semantic file actions and vault-relative status snapshots; Git never paints Project rows. Content is optional. Without Borders, the existing Commit command and native file-menu actions remain available. Obsidian Git can remain disabled.

The repository is discovered from the vault directory, including a parent repository or linked worktree. The commit panel lists paths relative to that repository, including files outside the vault when the vault is nested inside a larger repository.

## Commit panel

- The line-and-circle ribbon button opens or hides the left Commit panel without destroying its draft.
- **Changes** contains tracked modifications and staged files. Staged names are green; other tracked modifications are blue.
- Unversioned Files contains unstaged new files with red names. Counts describe all files in each group.
- Group checkboxes support checked, unchecked and indeterminate states. Tracked changes start selected; new unversioned files start unchecked.
- Each selected file contributes its current working-tree content, including unstaged edits to a staged file. Renames include both paths; deletions are included.
- Commit uses a private index and preserves the staging of unchecked files. It locks the real index while reconciling the successful selection. Conflicts and active merge/rebase/cherry-pick operations must be completed separately.
- Amend replaces the latest commit after confirmation. An empty message is filled from that commit when Amend is enabled.
- Commit and Push reports commit success independently of push failure. Retry a failed push through Push, without creating another commit.
- Commit drafts persist across panel closure and plugin reload.
- The message-history button lists recent commit messages and inserts the selected full message into the draft. The amendment target is the last commit.
- The footer counts selected unversioned files as added and selected Changes files as modified. Missing files or a missing message produce an inline error when either commit button is clicked.
- The file list and message section share the available panel height equally. The toolbar follows the IDEA layout: Refresh Changes, Rollback, Show Diff, Shelve Silently, View Options, Select Opened File in Change View, Expand All and Collapse All.

## Shelved changes

Shelve Silently saves only the checked tracked files, then reverts those paths. Unversioned files and conflicts cannot be shelved. Binary-safe working-tree and index patches are saved under the repository's Git directory in `patchwork-shelves`, preserving partial staging without touching unchecked files. A shelf is saved before any selected files are reverted.

Use **View Options → Shelved Changes** to restore a shelf. Existing local changes to the same files block restoration. Successful restoration also restores the selected files' staging; the saved patch files remain on disk as a backup. No stash entries or commits are created by shelving.

## File and branch actions

File and multi-file context menus provide a Git submenu: Commit, Add, Unstage, Show Diff, Show History, Rollback, Fetch, Pull and Push. Double-clicking a commit-panel row shows its diff. Diff/history output is read-only. Rollback requires confirmation and refuses additions, renames and conflicts rather than deleting new files implicitly.

Project renders filenames from Git's public status snapshot: modified files are blue, unversioned files red, and staged files green. Project owns those colors and updates rows when folders expand or files are renamed. Git ignore rules still apply: a never-tracked ignored file is absent from both the commit list and Git history until its ignore rule is changed and the file is committed.

The titlebar uses the same interface font as the theme. Its existing branch search, Recent/Local/Remote groups, checkout, new branch, revision checkout, Update Project, Commit and Push actions now use this plugin.

Git identity, signing, hooks, remotes, upstreams and credential helpers follow the local Git configuration. Update Project fetches on invocation and applies the selected Merge or Rebase method, remembered for subsequent updates. Push never forces an update. Missing configuration and authentication failures are shown as Git errors. Remote branch menus also provide compare, rebase, merge and worktree actions through the existing serialized mutation queue.

### Update semantics

The reference is JetBrains `intellij-community` commit `8eee455aa813af4ad427fd576b0ad8d94c418577`, specifically `GitUpdateSelectedBranchAction.kt`, `GitBranchActionsUtil.kt`, `GitUpdateProcess.java`, `GitUpdateOptionsPanel.kt` and `FixTrackedBranchDialog.kt` under `plugins/git4idea/backend/src`.

- **Update Project** in the header and Log toolbar runs directly against the checked-out local branch, regardless of the selected history branch. It fetches the configured remote refspecs, refreshing other remote-tracking branches without updating other local branches. Merge is the default; a saved Rebase preference is respected. An up-to-date branch leaves local changes untouched.
- The configured upstream takes precedence. Without an upstream, a unique same-name remote branch or the sole remote supplies the destination without modifying tracking configuration. This compatibility fallback is a deliberate user-requested deviation from IDEA. An ambiguous destination opens selection; ordinary updates do not open an options panel. A target absent from the fetch result is rejected, even if a stale remote-tracking ref exists.
- **Update Project** on the current branch context menu uses the same direct project action. **Update Selected Branch** on another branch remains branch-specific: current branches use the saved method, while non-current branches fast-forward without checkout. A branch checked out in another worktree is fetched and fast-forwarded there. Missing tracking opens destination selection for this separate action. Busy operations block concurrent updates, and no-remotes repositories hide the action.
- After fetch, a missing common ancestor blocks both Merge and Rebase before local-change preservation. Independent histories require separate reconciliation; Update never implicitly allows unrelated histories.
- Working-tree updates can save tracked and untracked changes and restore their staged state. Conflicts retain the identifiable stash for recovery. Active Git operations block overlapping updates. Other-worktree updates use native fast-forward merge protection rather than stashing that worktree's changes.

This is not complete IDEA Update parity: project-wide multi-repository coordination, IDE shelf-based preservation, rebase-over-merge choices, force-push recovery, automatic conflict-resolution dialogs and IDEA's update-results view remain separate gaps. The plugin updates the active repository and uses its existing operation/conflict UI. Disposable repository validation covers no-op, automatic fetch, staged/untracked restoration, divergent merge/rebase, non-current branches, another worktree and update-conflict stash retention.

## Log and lifecycle

The bottom Log panel has independent tabs, a branch/tag tree, commit graph,
text/hash/author/date/path filters, changed-file details and read-only Diff tabs.
Git owns its tab appearance; the shared tab helper only manages granted DOM.
The branch header and Log subscribe to semantic snapshots, including ignored-only
status changes. The legacy `patchwork-git:refreshed` event remains emitted for
external consumers; internal integrations no longer subscribe to it.

Popup options migrate validated missing values from `patchwork-power-editor`
data into Git data once. Existing target values take precedence. A single
serialized store merges draft, changelist and individual popup-option updates
with the latest data, preserving migration markers and unknown keys. The final
draft is queued for saving and the store is flushed on unload. Donor data stays
intact. Unload closes owned menus/dialogs, releases registrations/subscriptions,
and disposes repository and imported-history processes. Imported mutations
delegate to the same repository queue.

Log reads and Diff tabs use their owning document. Actions requiring current
main-window dialogs fail explicitly in pop-out windows. Live window placement,
Git operations, settings migration and repeated enable/disable scenarios still
require Obsidian acceptance; static checks do not establish runtime compatibility.

Module source and CSS boundaries are checked before bundling. Terminal is an
independent package and does not share a Git panel implementation. Runtime
appearance and enable/disable recovery are tracked in the repository acceptance
checklist; source checks do not establish live compatibility.


## Git History capabilities

Patchwork retains its original Git tool: the branch rail and tree, filter bar,
25px commit rows, changed-file list, right-hand commit details and existing tabs.
The Git History 1.13.0 integration supplies headless capabilities only. No upstream
views, stylesheets, source-control sidebar, toolbar or terminal UI are mounted.

The existing filters use its history backend for branch, author, date, text/body,
hash and path queries, including regular expressions and case sensitivity.
Single-file history follows renames; multi-file and directory histories retain
normal Git path filtering. The original graph cells use the imported topology
algorithm and Patchwork's colors. The list renders only visible rows with overscan,
and immutable commit-file details use a bounded cache. Each existing Log tab has
independent filters, paging and selection. HEAD changes and Git mutations refresh
visible logs; editing unrelated note text does not reload commit history.

File-menu **Show History** and **Patchwork Git: Open Git history** open this same
Git tool. Commit menus provide revision/message copying, branch creation,
detached checkout, cherry-pick and revert. Merge cherry-pick/revert are disabled
because they require an explicit mainline choice. File menus provide history,
diff, current-file navigation and guarded restoration. Changed-file details
include rename metadata, binary markers and line counts, including root commits
and merge changes grouped by parent in the commit details panel.

The existing Diff tab uses imported diff parsing and word comparison behind
Patchwork's own controls. It supports unified and side-by-side layouts. Working
diffs expose separate worktree/index comparisons and context-menu hunk staging,
unstaging and confirmed reversion. Hunk writes preserve Git patch headers and
no-final-newline markers and reject stale comparisons. Rename, binary, addition
and deletion hunks are not offered for partial writes. The existing Commit
panel, selection-based commit semantics, dialogs and branch menus remain owned
by their original modules. All imported mutations enter the existing repository
queue, and file restoration refuses dirty paths. No automatic pull is enabled.

Upstream installation is unnecessary. The full MIT notice for Chris Oguntolu's
code is retained in `src/history/LICENSE` and the generated JavaScript bundle.
The separately downloaded history-view plugin is not integrated. Settings left
by the earlier UI import remain preserved as unknown data, without mounting its
interface or replacing existing Git drafts and popup preferences.

## Background operation progress

Git consumes the existing `BordersApi.progress` through the service registry.
Fetch, Update, Push, Commit, branch actions and task-modal mutations register an
indeterminate task for the operation. Status refresh does not keep a completed
operation's progress visible. Fetch runs independently of background status scans. Opening a
Push/Update dialog alone does not start a task. The existing 200 ms display delay
prevents flashes for quick operations. No percentage is fabricated. Fetch and Clone register cancellation callbacks,
so their X controls abort the owned Git process tree. Merge/rebase cancellation
and recovery remain separate actions.

Every exit path finishes the handle, including operation failures; refresh starts after progress cleanup.
Git unload aborts presentation lifetime. Provider replacement reattaches active
presentation without restarting Git commands; missing Borders allows Git work
to continue without a footer task. Tasks retain the invoking window and never
fall back to another window when that window closes.

Validation covered provider absence/arrival/replacement, Git presentation disposal,
and success, operation-error and refresh-error cleanup. An installed real Fetch
showed `Git: Fetch` and finished with no remaining task or HEAD change. An
installed Update with a temporary simulated fetch failure showed the existing
indeterminate footer bar and hid it after failure; the diagnostic override was
restored without updating repository files.

Git command deadlines are enforced independently of child exit/stdio callbacks.
On Windows, cancellation and deadlines terminate only the command's process tree,
including network helpers. This also prevents an exited process with a missing
completion callback from keeping Git busy indefinitely. Cancelling Fetch does not
roll back remote-tracking refs already received, and cancelling Clone may leave a
partial destination; neither action reports success after cancellation.

## Commit details panel

The existing Patchwork panel follows the single-commit flow in JetBrains
intellij-community revision `6cd53e000b1c7c418972a0910651518e205b38df`:
`MainFrame`, `VcsLogChangesBrowser`, `ChangesBrowserBase` and `CommitDetailsLoader`.
The upper changed-files tree and lower commit metadata retain their draggable,
persisted splitter. The repository is a real tree node included in Expand All
and Collapse All, rather than a fixed heading outside the tree.

Folder labels select their contained files; disclosure arrows and label double
clicks expand or collapse. Arrow keys navigate visible nodes; Left/Right control
folders. File double click or Enter opens Diff. Directory grouping and the
existing file context actions remain available. Merge commits have a separate
file group per parent, and file identity includes that parent for selection and
Diff. Reverting merge files remains disabled until a mainline is explicitly
supported. Multi-commit selection retains the existing Compare Selected flow;
it does not yet implement IDEA's aggregated multi-commit change model.

Selecting another commit aborts the previous detail commands and guards against
stale results, repository changes and disposed views. Loading and empty states
are explicit. Disposable-repository validation covered root commits, distinct
changes against both merge parents and pre-aborted detail requests.

Installed validation confirmed physical repository-label selection, repeated
arrow collapse/expand with matching SVGs, physical file double click opening the
existing Diff view, and rapid commit switching cancelling the old request while
showing only the latest selection. No console errors were captured. Splitter
behavior is retained from the existing panel and was not revalidated in this change.

Historical file comparisons from the commit details panel now open in a scoped,
resizable modal instead of a Content tab. The dialog reuses the existing diff
renderer, supports unified/side-by-side presentation and change navigation, and
closes with its owning pane/controller. Folder selection highlights the folder
only while retaining its files as action targets. Inactive commit selections
use gray; only the focused tree/list uses blue. Repository headings use normal
font weight. Installed pointer validation confirmed these selection states and
dialog opening without creating a workspace Diff tab. The dialog was closed
before the subsequent mode-switch check, so that check remains unverified.
