# Commit Options

The gear opens a non-modal, anchored panel. Escape, an outside pointer press,
or a second gear click closes it. Repository changes, active operations and
owner unloading invalidate the panel.

## IDEA references

Reviewed JetBrains/intellij-community revision
`2b682032a7704a94bf3f15a3f6f8638ceba8a0fa`:

- [ShowCommitOptionsAction](https://github.com/JetBrains/intellij-community/blob/2b682032a7704a94bf3f15a3f6f8638ceba8a0fa/platform/vcs-impl/src/com/intellij/openapi/vcs/actions/ShowCommitOptionsAction.kt)
- [CommitOptionsPanel](https://github.com/JetBrains/intellij-community/blob/2b682032a7704a94bf3f15a3f6f8638ceba8a0fa/platform/vcs-impl/src/com/intellij/vcs/commit/CommitOptionsPanel.kt)
- [GitCommitOptionsUi](https://github.com/JetBrains/intellij-community/blob/2b682032a7704a94bf3f15a3f6f8638ceba8a0fa/plugins/git4idea/backend/src/checkin/GitCommitOptions.kt)
- [GitSkipHooksCommitHandlerFactory](https://github.com/JetBrains/intellij-community/blob/2b682032a7704a94bf3f15a3f6f8638ceba8a0fa/plugins/git4idea/backend/src/checkin/GitSkipHooksCommitHandlerFactory.kt)
- [GitRepositoryCommitter](https://github.com/JetBrains/intellij-community/blob/2b682032a7704a94bf3f15a3f6f8638ceba8a0fa/plugins/git4idea/backend/src/checkin/GitRepositoryCommitter.kt)

## Supported behavior

- Author is a plain text input accepting `Name <email>`, without suggestions, and applies
  `--author` to the next commit. Blank uses Git defaults. The override is scoped
  to the active repository and cleared after a successful commit or plugin reload.
- Sign-off persists in Git preferences and applies `--signoff`. It is a trailer,
  not a cryptographic signature. Repository signing configuration remains active.
- Run Git hooks defaults to enabled for each commit session. It appears when
  pre-commit or commit-msg hook files exist at Git's resolved hooks path.
  Unchecking applies IDEA's `--no-verify` behavior; other hooks still execute.
- Check whitespace retains Patchwork's existing `git diff --cached --check`
  validation against the exact index being committed.
- Commit Scope retains the existing choice of staged changes or complete checked
  files. Both paths use identical author, sign-off and hooks options. The checked
  file path preserves unrelated staged changes through its private index.
- Amend remains in the Commit panel rather than being duplicated in the popup.

IDEA's language inspection, reformatting, import optimization, TODO checks and
explicit-movement providers have no matching capability in this project. Their
options are not presented as nonfunctional checkboxes. Post-commit external tools
and split rename commits are not implemented by this change.

## Validation

Disposable-repository checks exercised both commit paths, author overrides,
sign-off trailers, default hook rejection, explicit hook bypass, unchanged
HEAD/index after failed hooks, preservation of unrelated staging, whitespace
rejection and malformed-author rejection. No user repository was committed.

Installed pointer checks confirmed opening from the gear, closing with a second
press, Escape restoring gear focus, and outside-click dismissal. The live panel
uses Git module scope and 12px typography. No console errors were captured;
debugging was detached after verification.
