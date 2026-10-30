# Patchwork Git

An independent desktop Git plugin with an IDEA-style commit tool window. It uses the existing `git` executable and does not require Obsidian Git or additional packages.

## Integration

The plugin target is `git`, registered in `../manifest.json`; the generated plugin ID is `patchwork-git`. The existing Patchwork build/install workflow discovers this target. Enable **Patchwork Git** after installing it. Install the corresponding **Patchwork Editor** update to connect its titlebar menu and left ribbon. Obsidian Git can remain disabled.

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

Project filenames use the same status snapshot: modified files are blue, unversioned files red, and staged files green. Colors also update when folders expand or files are renamed. Git ignore rules still apply: a never-tracked ignored file is absent from both the commit list and Git history until its ignore rule is changed and the file is committed.

The titlebar uses the same interface font as the theme. Its existing branch search, Recent/Local/Remote groups, checkout, new branch, revision checkout, Update Project, Commit and Push actions now use this plugin.

Git identity, signing, hooks, remotes, upstreams and credential helpers follow the local Git configuration. Pull uses fast-forward only; Push never forces an update. Missing configuration and authentication failures are shown as Git errors. Advanced IDEA operations such as interactive rebase, a graphical history graph and worktree management are not implemented here.
