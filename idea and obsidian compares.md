# IntelliJ IDEA Git and Obsidian Patchwork Git Comparison

Audit date: 2026-11-04. Update workflow follow-up: 2026-11-05.

## Project interaction follow-up (2026-11-05)

- Project-tree Git Add stays enabled by request. It refreshes status and stages
  unstaged paths within the selection; an empty selection of changes is a no-op.
  This is an intentional difference from IDEA's status-dependent Add action
  ([GitAdd.kt](https://github.com/JetBrains/intellij-community/blob/master/plugins/git4idea/backend/src/actions/GitAdd.kt)).
- Explorer rows and menus share Git's 12px Microsoft YaHei UI typography.
- Double Shift opens Project Search Everywhere, with All, Files and Text tabs.
  The modifier gesture follows IDEA's
  [ModifierKeyDoubleClickHandler](https://github.com/JetBrains/intellij-community/blob/master/platform/platform-impl/src/com/intellij/openapi/keymap/impl/ModifierKeyDoubleClickHandler.kt).
  Search covers vault-visible names, paths and supported plain-text contents;
  Actions now searches native Obsidian commands. The original substring search
  was replaced with a source-derived IDEA matcher, contributor pagination,
  highlighting, line/column navigation and search history. All loads 15 results
  per contributor; individual tabs load 30, with More to continue. Text reads
  retain a 5 MiB file limit. See the [pinned source mapping](plugins/project/src/search/SOURCE.md)
  for translated algorithms, runtime adaptations and remaining parity gaps.
  Binary, encrypted and unsupported text formats are excluded from content reads.

## Baseline and scope

The reference is JetBrains `intellij-community` revision `8eee455aa813af4ad427fd576b0ad8d94c418577`. The visual reference is Islands Dark with the locally reported 12px Microsoft YaHei UI setting. This is a fixed source baseline, not a claim about every IDEA release, edition or plugin combination.

The implementation baseline is the **current working tree** of `D:\ideaProjects\obsidian-patchwork`, based on commit `f3117df`, including uncommitted Git changes. "Our implementation" means the reachable Patchwork Git interface and its actual operation path, not every method imported from the Git History backend. Project and Borders are counted only where Git uses their public integration.

The inventory was constructed from IDEA action registrations and source areas first, then compared with Patchwork source. It contains **256 feature rows in 14 categories**: 248 core/shared-interface rows and 8 optional hosting rows. The action crosswalk accounts for **all 122 explicitly identified action registrations** in the pinned Git backend/frontend/shared XML files: 121 product-facing registrations and one excluded internal test action. Shared VCS, Log and Diff facilities are grouped by user-visible capability; menu aliases are not separate implementations.

This is a comprehensive scoped feature inventory, not a guarantee that every dynamically supplied action, platform extension, third-party integration, hidden setting or future release has been enumerated. Optional hosting integrations are separated from Git core; general editor capabilities are included only when part of the Git workflow.

## Reading the completion column

Completion is an **engineering coverage estimate for the named row**, not a measured test-pass rate, elapsed development progress or a promise of bug-free behavior. Scores use coarse bands to avoid false precision:

- **100%**: the narrowly named capability has a reachable implementation and no known gap within that row's stated scope. This does not certify pixel-perfect IDEA parity or every operating-system edge case.
- **<span style="color: #F57E84;">75%</span>**: the main user flow exists, with documented option, edge-case, interaction or integration gaps.
- **<span style="color: #F57E84;">50%</span>**: a meaningful subset exists, but a substantial workflow or UI component is missing.
- **<span style="color: #F57E84;">25%</span>**: only supporting behavior, a backend dependency or an alternative manual flow exists; the IDEA workflow is largely missing.
- **<span style="color: #F57E84;">0%</span>**: no usable implementation of this capability was found. **The implementation cell is deliberately empty.**

All percentages below 100% are red HTML spans for Markdown preview/Obsidian Reading View. Raw Markdown source displays the markup. A renderer that strips inline styles may not preserve the color.

Present but incomplete cells state the gap. A raw Git command or unused backend method does not count as a finished interface. For example, a backend patch helper is not an Apply Patch dialog; resetting HEAD is not IDEA's Uncommit/changelist workflow; Git-native merge preservation is not unrestricted merge-topology editing.

No single overall percentage is reported: these rows have very different sizes, overlap across surfaces, and are not effort-weighted. Counting small visual corrections equally with a merge engine would produce a misleading product-completion number.

Snapshot counts: **74 fully covered narrow rows**, **115 partial rows**, **67 absent rows**. These are row counts, not an aggregate parity score.

## Feature inventory and implementation comparison

### High-frequency acceptance, 2026-11-04

The 28 previously incomplete rows scored 80 or higher were implemented or completed against their named scope and checked before promotion to 100%. This does not promote lower-frequency capabilities or certify pixel-identical rendering across Swing and Electron.

| Coverage | Checks performed |
| --- | --- |
| Repository/status/Commit | Disposable repository discovery and semantic-status checks; installed staged/unstaged/conflict UI matrix; directory sorting/grouping; four path-copy variants; source-navigation window/path guards; multiline draft and concurrent-settings persistence. |
| Commit All and Commit and Push | Tracked-only selection excludes unversioned files; commit failure prevents Push; successful commit finishes refresh before opening the push preview. Commit All semantics were checked against IDEA's GitStageCommitWorkflow and GitToggleStageSettingAction. |
| Network | Native disposable repositories cover fast-forward, merge, rebase, staged/untracked restoration, failed updates and both update/restore conflicts. A 204-commit preview verifies pagination; a local bare remote verifies target selection, keep/set upstream and stale-source rejection. |
| Log/Diff | Merge topology and unloaded-parent continuation checks; installed details/branch actions; unified and split word-plus-syntax rendering; physical history navigation; accessible selection and restored Log tabs. |
| Editor integration | 1,000 replacement/rollback round trips; installed Markdown and Code Editor gutter rollback; physical pointer rollback; stale path/baseline/document and read-only rejection; native baseline, encrypted-file, vault-boundary and cancellation guards. |
| Appearance/lifecycle | Official namespaced rail artwork, no missing inspected toolbar icons, 12px text, 30px history rows, one-pixel dividers and #191A1C details; targeted plugin builds/install/reloads, type checks, JavaScript syntax and module-boundary checks. |

All repository mutation fixtures were disposable. No user repository was committed or pushed by these checks. Temporary editor fixtures and temporary diagnostic overrides were removed. Lower-frequency gaps remain explicitly listed below.

### 01. Repository setup and configuration

IDEA: [I1], [I2]. Patchwork: [P1], [P2], [P3].

| IntelliJ IDEA Git capability | Our Obsidian Patchwork Git implementation | Completion | Daily-use frequency |
| --- | --- | --- | --- |
| <a id="r01"></a>**R01** Initialize a Git repository | Initialize Repository command and native git init. | 100% | 8|
| <a id="r02"></a>**R02** Clone by URL, branch/tag, depth and submodules | Options implemented; simpler progress and project-opening workflow. | <span style="color: #F57E84;">75%</span> | 20|
| <a id="r03"></a>**R03** Cancel clone and report failures | Cancellation exists; not the complete IDEA workflow. | <span style="color: #F57E84;">75%</span> | 6|
| <a id="r04"></a>**R04** Select and validate Git executable | Path, version validation and saved preference. | 100% | 8|
| <a id="r05"></a>**R05** Repository root discovery | Vault/parent discovery plus an explicit nested-repository scan and validated switching; linked and application/dependency internals are excluded. | 100% | 90|
| <a id="r06"></a>**R06** Directory mappings and multiple active roots | One active root can be switched; no simultaneous multi-root model. | <span style="color: #F57E84;">25%</span> | 20|
| <a id="r07"></a>**R07** Synchronized multi-repository operations |  | <span style="color: #F57E84;">0%</span> | 12|
| <a id="r08"></a>**R08** Open external repository Log | Limited to the active vault-related repository. | <span style="color: #F57E84;">25%</span> | 12|
| <a id="r09"></a>**R09** Unshallow repository from UI |  | <span style="color: #F57E84;">0%</span> | 4|
| <a id="r10"></a>**R10** Repository user name/email | Repository-local identity settings. | 100% | 8|
| <a id="r11"></a>**R11** Commit signing | Signing key and commit.gpgsign; native Git signing without agent setup. | <span style="color: #F57E84;">75%</span> | 12|
| <a id="r12"></a>**R12** GPG agent configuration UI |  | <span style="color: #F57E84;">0%</span> | 4|
| <a id="r13"></a>**R13** HTTP/SSH authentication UI | Configured credential helpers/agents are used; no account or credential dialog. | <span style="color: #F57E84;">25%</span> | 18|
| <a id="r14"></a>**R14** List/add/edit/remove remotes | Remote manager with selection and validation. | <span style="color: #F57E84;">75%</span> | 15|
| <a id="r15"></a>**R15** Persistent Git console and command history | Errors/output dialogs only. | <span style="color: #F57E84;">25%</span> | 35|
| <a id="r16"></a>**R16** Git add/remove, update and branch preferences | Executable, identity, signing and local protection; most IDEA settings absent. | <span style="color: #F57E84;">25%</span> | 15|

### 02. File status, moves and ignore rules

IDEA: [I1], [I4], [I5]. Patchwork: [P1], [P4], [P5].

| IntelliJ IDEA Git capability | Our Obsidian Patchwork Git implementation | Completion | Daily-use frequency |
| --- | --- | --- | --- |
| <a id="f01"></a>**F01** Tracked/modified/added/deleted/ignored/conflicted states | Native tracked, modified, added, deleted, ignored, unversioned and conflict states; staged and working-tree sides retain their own status. | 100% | 100|
| <a id="f02"></a>**F02** Separate unversioned files | Unversioned Files group and add/ignore actions. | 100% | 95|
| <a id="f03"></a>**F03** File/folder status colors | Semantic file colors and ancestor-folder aggregation, with conflict priority and restoration when the Git provider disappears. | 100% | 100|
| <a id="f04"></a>**F04** Observe IDE file moves and update index | Vault old/new-path events synchronize the real index. | <span style="color: #F57E84;">75%</span> | 65|
| <a id="f05"></a>**F05** Directory moves update tracked descendants | Implemented; untracked descendants excluded. | 100% | 55|
| <a id="f06"></a>**F06** Case-only renames | Old index spelling removed before destination add; Windows fixture verified. | <span style="color: #F57E84;">75%</span> | 12|
| <a id="f07"></a>**F07** Chained moves and concurrent rename retry | Batched path chaining, validation and retry. | 100% | 30|
| <a id="f08"></a>**F08** Configurable add/remove policies during moves | Auto-stages moved contents; IDEA policy/confirmation choices absent. | <span style="color: #F57E84;">25%</span> | 20|
| <a id="f09"></a>**F09** Cross-repository move workflow |  | <span style="color: #F57E84;">0%</span> | 8|
| <a id="f10"></a>**F10** External/unobserved move detection | Private-index similarity fallback; no retrospective auto-staging. | <span style="color: #F57E84;">50%</span> | 35|
| <a id="f11"></a>**F11** Moved-from and renamed-from presentation | Correct wording/color; repository-relative paths rather than full IDEA path shortening. | <span style="color: #F57E84;">75%</span> | 65|
| <a id="f12"></a>**F12** Rollback ordinary tracked changes | Confirmation and guards; stricter restrictions than IDEA. | <span style="color: #F57E84;">75%</span> | 60|
| <a id="f13"></a>**F13** Rollback additions/renames as complete changes |  | <span style="color: #F57E84;">0%</span> | 35|
| <a id="f14"></a>**F14** Add selected files to VCS | Stages selected files and both move paths. | 100% | 90|
| <a id="f15"></a>**F15** Add selected files to .gitignore | Escaped exact-path patterns. | <span style="color: #F57E84;">75%</span> | 45|
| <a id="f16"></a>**F16** Add selected files to local exclude | Writes .git/info/exclude. | <span style="color: #F57E84;">75%</span> | 25|
| <a id="f17"></a>**F17** Open Git exclude file directly |  | <span style="color: #F57E84;">0%</span> | 10|
| <a id="f18"></a>**F18** Toggle ignored files in staging view | Ignored status available; equivalent staging-tree toggle absent. | <span style="color: #F57E84;">25%</span> | 20|
| <a id="f19"></a>**F19** Automatic add/remove for ordinary file creation/deletion | Status refresh only; index automation applies to renames. | <span style="color: #F57E84;">25%</span> | 45|

### 03. Commit and changelists

IDEA: [I3], [I4]. Patchwork: [P1], [P5], [P6].

| IntelliJ IDEA Git capability | Our Obsidian Patchwork Git implementation | Completion | Daily-use frequency |
| --- | --- | --- | --- |
| <a id="c01"></a>**C01** Commit tool window | Reachable Commit rail/tool window with staged and checked-file modes, resize controls, operation state and selection-aware actions. | 100% | 100|
| <a id="c02"></a>**C02** Independent inclusion checkboxes and row selection | Implemented. | 100% | 95|
| <a id="c03"></a>**C03** Commit selected files | Private-index commit preserves unrelated staging. | 100% | 95|
| <a id="c04"></a>**C04** Multiline message and persisted draft | Multiline message editor with spellcheck, message history, repository-specific message/amend drafts and serialized persistence that preserves unrelated settings. | 100% | 100|
| <a id="c05"></a>**C05** Commit message history | Repository messages can be selected; not full IDEA history model. | <span style="color: #F57E84;">75%</span> | 40|
| <a id="c06"></a>**C06** Amend last commit | Amend option and complete message loading. | 100% | 55|
| <a id="c07"></a>**C07** Commit and Push | Successful commit and refresh precede the push preview; rejected commits do not open Push. | 100% | 90|
| <a id="c08"></a>**C08** Create/rename/assign changelists | Persisted local lists and move-to-list actions. | <span style="color: #F57E84;">75%</span> | 45|
| <a id="c09"></a>**C09** Delete changelists |  | <span style="color: #F57E84;">0%</span> | 20|
| <a id="c10"></a>**C10** Active/default changelist and assignment rules |  | <span style="color: #F57E84;">0%</span> | 25|
| <a id="c11"></a>**C11** Changelist descriptions and task association |  | <span style="color: #F57E84;">0%</span> | 10|
| <a id="c12"></a>**C12** Changelist ownership follows moves | Assignments/selection migrate after successful index update. | 100% | 40|
| <a id="c13"></a>**C13** Change author/date in commit UI |  | <span style="color: #F57E84;">0%</span> | 8|
| <a id="c14"></a>**C14** Sign-off and trailer assistance |  | <span style="color: #F57E84;">0%</span> | 12|
| <a id="c15"></a>**C15** Message inspections, issue links and completion |  | <span style="color: #F57E84;">0%</span> | 40|
| <a id="c16"></a>**C16** Native Git hooks | Hooks remain enabled; no complete configuration/skip UI. | <span style="color: #F57E84;">75%</span> | 70|
| <a id="c17"></a>**C17** Whitespace/conflict-marker pre-commit check | Optional diff --check on relevant index; not IDEA inspections. | <span style="color: #F57E84;">50%</span> | 65|
| <a id="c18"></a>**C18** Reformat/optimize imports before commit |  | <span style="color: #F57E84;">0%</span> | 35|
| <a id="c19"></a>**C19** Code analysis, cleanup and TODO checks |  | <span style="color: #F57E84;">0%</span> | 30|
| <a id="c20"></a>**C20** Run tests/configurable tasks before commit |  | <span style="color: #F57E84;">0%</span> | 25|
| <a id="c21"></a>**C21** Commit-check results and rerun/override workflow |  | <span style="color: #F57E84;">0%</span> | 35|
| <a id="c22"></a>**C22** Partial commits from line/range inclusion | Hunks can be staged; arbitrary-line inclusion absent. | <span style="color: #F57E84;">50%</span> | 60|
| <a id="c23"></a>**C23** Commit templates/external message editor UI |  | <span style="color: #F57E84;">0%</span> | 25|
| <a id="c24"></a>**C24** Create fixup/squash commit targeting a commit |  | <span style="color: #F57E84;">0%</span> | 12|
| <a id="c25"></a>**C25** Paths, sorting and locate opened file | File paths, name/path sorting, directory grouping and locate-opened-file navigation in the invoking window, including collapsed groups. | 100% | 85|
| <a id="c26"></a>**C26** Jump to source, delete and copy paths | Jump to source, trash deletion, absolute path, repository-relative path, vault-relative path and file-name copying. | 100% | 80|

### 04. Staging area

IDEA: [I1] Git.Stage actions. Patchwork: [P1], [P5], [P7].

| IntelliJ IDEA Git capability | Our Obsidian Patchwork Git implementation | Completion | Daily-use frequency |
| --- | --- | --- | --- |
| <a id="s01"></a>**S01** Enable/disable staging-area workflow | Staged vs checked-file mode; not separate staging tree. | <span style="color: #F57E84;">50%</span> | 20|
| <a id="s02"></a>**S02** Stage selected files | Includes both move paths. | 100% | 90|
| <a id="s03"></a>**S03** Unstage selected files | Preserves working files. | 100% | 65|
| <a id="s04"></a>**S04** Stage all / tracked only | Selection/group staging exists; dedicated variants incomplete. | <span style="color: #F57E84;">50%</span> | 65|
| <a id="s05"></a>**S05** Add without content / intent-to-add |  | <span style="color: #F57E84;">0%</span> | 8|
| <a id="s06"></a>**S06** Stage/unstage/revert hunks | Diff menus with stale checks and restrictions. | <span style="color: #F57E84;">75%</span> | 60|
| <a id="s07"></a>**S07** Stage arbitrary selected lines |  | <span style="color: #F57E84;">0%</span> | 35|
| <a id="s08"></a>**S08** Pairwise HEAD/index/working-tree comparison | Three baseline choices. | 100% | 75|
| <a id="s09"></a>**S09** Simultaneous three-version comparison |  | <span style="color: #F57E84;">0%</span> | 25|
| <a id="s10"></a>**S10** Open staged version as editor document |  | <span style="color: #F57E84;">0%</span> | 20|
| <a id="s11"></a>**S11** Open local working version | Staged and unstaged rows expose Jump to Source/F4 using the current working file, preserving the invoking window/document group and rejecting unavailable paths. | 100% | 85|
| <a id="s12"></a>**S12** Staged/unstaged trees and commit-all toggle | Separate staged/unstaged/conflict/unversioned groups, side-specific Diff and Commit All for tracked changes; unversioned files are excluded and Amend retains staged semantics. | 100% | 80|
| <a id="s13"></a>**S13** Stash selected staging-area files | Selected-path stash outside staging tree. | <span style="color: #F57E84;">50%</span> | 25|
| <a id="s14"></a>**S14** Staging conflict accept ours/theirs/merge | Conflict modal rather than full staging-tree actions. | <span style="color: #F57E84;">50%</span> | 30|

### 05. Branch popup and branch operations

IDEA: [I1], [I2], [I6]. Patchwork: [P8], [P9].

| IntelliJ IDEA Git capability | Our Obsidian Patchwork Git implementation | Completion | Daily-use frequency |
| --- | --- | --- | --- |
| <a id="b01"></a>**B01** Current branch and detached HEAD widget | Current-branch and detached-HEAD header, accessible label/tooltip and searchable branch popup. | 100% | 95|
| <a id="b02"></a>**B02** Local/remote/recent/favorite branch groups | Local/remote/recent groups, current and favorite artwork, current/favorite ordering and prefix grouping. | 100% | 80|
| <a id="b03"></a>**B03** Speed search and keyboard navigation | Search/navigation; not complete IDEA matching/filtering. | <span style="color: #F57E84;">75%</span> | 70|
| <a id="b04"></a>**B04** Group by directory | Popup/dashboard grouping. | 100% | 45|
| <a id="b05"></a>**B05** Group/filter by repository |  | <span style="color: #F57E84;">0%</span> | 15|
| <a id="b06"></a>**B06** Filter popup by available action |  | <span style="color: #F57E84;">0%</span> | 15|
| <a id="b07"></a>**B07** Recent/tag visibility preferences | Groups/tags exist; settings incomplete. | <span style="color: #F57E84;">50%</span> | 30|
| <a id="b08"></a>**B08** Resize popup / restore size | Persisted pointer/keyboard resizing. | 100% | 20|
| <a id="b09"></a>**B09** Create branch from reference | Header, branch menu and Log. | 100% | 65|
| <a id="b10"></a>**B10** Checkout local branch | Native switch with state checks. | 100% | 75|
| <a id="b11"></a>**B11** Checkout remote tracking branch | Creates tracking branch or validates existing one. | <span style="color: #F57E84;">75%</span> | 55|
| <a id="b12"></a>**B12** Checkout revision / detached HEAD | Log checkout with confirmation. | 100% | 20|
| <a id="b13"></a>**B13** Rename local branch | Native rename and name validation. | 100% | 20|
| <a id="b14"></a>**B14** Delete local branch | Safe branch -d; force-delete/recovery absent. | <span style="color: #F57E84;">75%</span> | 40|
| <a id="b15"></a>**B15** Delete remote branch | Confirmation, tip lease and local protection. | <span style="color: #F57E84;">75%</span> | 20|
| <a id="b16"></a>**B16** Merge branch into current | Native merge; advanced options incomplete. | <span style="color: #F57E84;">75%</span> | 55|
| <a id="b17"></a>**B17** Rebase current onto branch | Native rebase and recovery. | <span style="color: #F57E84;">75%</span> | 40|
| <a id="b18"></a>**B18** Checkout and rebase onto current | Action exists; smart-checkout recovery absent. | <span style="color: #F57E84;">75%</span> | 15|
| <a id="b19"></a>**B19** Checkout and update |  | <span style="color: #F57E84;">0%</span> | 25|
| <a id="b20"></a>**B20** Compare branches / branch versus working tree | Comparison dialogs and Diff tabs. | <span style="color: #F57E84;">75%</span> | 60|
| <a id="b21"></a>**B21** Update non-current branch | Fast-forward fetch into a non-current branch without checkout; branches checked out in another worktree use fetch and fast-forward merge there. Multi-selection and advanced recovery remain incomplete. | <span style="color: #F57E84;">75%</span> | 20|
| <a id="b22"></a>**B22** Pull selected remote branch with merge/rebase | Both actions exist. | <span style="color: #F57E84;">75%</span> | 45|
| <a id="b23"></a>**B23** Show My Branches | Exclusive-commit ownership; alias expansion incomplete. | <span style="color: #F57E84;">75%</span> | 35|
| <a id="b24"></a>**B24** Find merged local branches |  | <span style="color: #F57E84;">0%</span> | 15|
| <a id="b25"></a>**B25** Clean up obsolete/merged branches |  | <span style="color: #F57E84;">0%</span> | 15|
| <a id="b26"></a>**B26** Update after remote force-push |  | <span style="color: #F57E84;">0%</span> | 8|
| <a id="b27"></a>**B27** Local protected-branch patterns | Local regex remote-delete protection; narrower than IDEA semantics. | <span style="color: #F57E84;">50%</span> | 60|
| <a id="b28"></a>**B28** Synchronize server branch protection |  | <span style="color: #F57E84;">0%</span> | 25|
| <a id="b29"></a>**B29** Smart checkout with automatic save/restore |  | <span style="color: #F57E84;">0%</span> | 40|
| <a id="b30"></a>**B30** Track repositories synchronously |  | <span style="color: #F57E84;">0%</span> | 10|

### 06. Fetch, update and push

IDEA: [I1], [I6]. Patchwork: [P8], [P10].

| IntelliJ IDEA Git capability | Our Obsidian Patchwork Git implementation | Completion | Daily-use frequency |
| --- | --- | --- | --- |
| <a id="n01"></a>**N01** Fetch remote refs | Commands and popup/dashboard entry points. | 100% | 85|
| <a id="n02"></a>**N02** Incoming/outgoing preview | Push preview provides pinned incoming/outgoing counts and separate paginated lists; all commits remain reachable beyond the first 200. Update fetches on execution rather than requiring a pinned preview. | 100% | 85|
| <a id="n03"></a>**N03** Fast-forward/merge/rebase update | The header and Log toolbar Update Project directly fetch the current branch's remote and update only the checked-out local branch, using Merge by default or the saved Rebase preference. Other remote-tracking refs refresh without moving other local branches. Branch context-menu Update remains branch-specific. Native fast-forward, merge and rebase execution is covered; broader IDEA workflow gaps are listed below. | 100% | 90|
| <a id="n04"></a>**N04** Auto-save/restore changes during update | Stash saves tracked/untracked changes and restores staged state; update/restore conflicts retain the saved stash for explicit recovery. IDEA Shelf selection and automatic post-conflict restoration remain incomplete. | <span style="color: #F57E84;">75%</span> | 45|
| <a id="n05"></a>**N05** Push branch to selected remote target | Push preview pins the local commit and selected remote branch; upstream preservation or replacement is explicit; stale source plans are rejected. | 100% | 95|
| <a id="n06"></a>**N06** Multi-repository push dialog |  | <span style="color: #F57E84;">0%</span> | 15|
| <a id="n07"></a>**N07** Force push / force-with-lease for updates |  | <span style="color: #F57E84;">0%</span> | 15|
| <a id="n08"></a>**N08** Push up to selected commit |  | <span style="color: #F57E84;">0%</span> | 8|
| <a id="n09"></a>**N09** Push selected commits |  | <span style="color: #F57E84;">0%</span> | 6|
| <a id="n10"></a>**N10** Add commit to remote branch |  | <span style="color: #F57E84;">0%</span> | 5|
| <a id="n11"></a>**N11** Recent push-target history | Tracking/default remote only. | <span style="color: #F57E84;">25%</span> | 50|
| <a id="n12"></a>**N12** Rejected-push update/retry workflow | Error reporting; separate manual update. | <span style="color: #F57E84;">25%</span> | 35|
| <a id="n13"></a>**N13** Native push hooks | Native execution; IDE controls incomplete. | <span style="color: #F57E84;">75%</span> | 65|
| <a id="n14"></a>**N14** Configure upstream/tracking | Checkout/push configuration and optional upstream setup in Update Project; dedicated editor absent. | <span style="color: #F57E84;">75%</span> | 35|
| <a id="n15"></a>**N15** Scheduled automatic fetch |  | <span style="color: #F57E84;">0%</span> | 70|
| <a id="n16"></a>**N16** Incoming/outgoing indicators in branch widget | Header, branch popup and Log branch rows show outgoing/incoming arrows and counts, with comparison targets, divergence and missing-upstream explanations. | 100% | 95|

**Update workflow follow-up, 2026-11-05:** The pinned IDEA `GitUpdateProcess.fetchAndNotify` fetches the remote associated with the current branch, then updates that local branch. Other remote-tracking refs refresh according to the remote's fetch configuration; other local branches do not move. IDEA's separate `updateBranches` operation targets selected branches, including fast-forward updates of non-current branches. These are different actions.

The header and Log toolbar now expose **Update Project**, independent of the selected history branch. They execute directly without an options panel when the destination is unambiguous, using Merge by default or the saved Rebase preference. Upstream configuration takes precedence. For a missing upstream, a unique same-name remote branch (or the sole configured remote) supplies the destination without changing tracking configuration. This fallback is a user-requested compatibility behavior, not identical IDEA behavior. Only an ambiguous destination opens selection. Branch context-menu Update retains its branch-specific semantics.

Validation used disposable repositories: only the current local branch advanced; another remote-tracking branch refreshed while its local branch remained unchanged; staged/untracked state was restored; repeated updates returned up-to-date; tracking configuration stayed unchanged. A deleted target was rejected instead of merging its stale cached ref, and ambiguous remotes required selection. JavaScript syntax, type and module-boundary checks passed. No update was executed against the user's notes repository.

Git alone was built, installed and reloaded, and installed runtime hashes matched. Physical pointer validation selected `develop` while the checked-out branch remained `main`; a temporary no-mutation dispatch probe confirmed the toolbar invoked Update Project once, independent of selection. The probe was restored immediately and debugging detached; no console errors were captured.

The current-branch context-menu entry is also Update Project and uses the same direct action; non-current entries are explicitly labeled Update Selected Branch. After fetching, updates verify a common ancestor before saving changes or invoking merge/rebase. Unrelated histories produce an actionable error and leave local commits, index and files untouched. Disposable independent-root repositories verified this guard and the direct current-branch context dispatch. The notes repository was inspected read-only: local and remote branch families have different roots and no merge base; ordinary Update cannot reconcile them. No forced unrelated-history merge is performed.

All visible update command, toolbar, context-menu and dialog labels are now **Update**, as requested. References to IDEA Update Project and Update Selected above distinguish operation semantics, not the current Patchwork labels. The history-reconciliation blocker is independent of these labels.

**Remaining parity gaps:** project-wide multi-repository coordination, IDE Shelf-based preservation, rebase-over-merge choices, force-push recovery, automatic conflict-resolution dialogs and IDEA's update-results view. N03's 100% applies only to its named native update capability; neither entry is claimed to reproduce the complete IDEA Update workflow at 100%.

N16 was implemented during the 2026-11-05 follow-up. Counts compare immutable branch tips against the configured upstream, or a unique same-name remote branch when no upstream exists; the latter is explicitly identified in the tooltip. Missing or ambiguous comparisons are not presented as synchronized. A branch without an upstream or matching branch on its sole remote shows a publish indicator without an invented count. Counts reflect the last known remote-tracking state; scheduled remote refresh remains [N15](#n15). The arrows are status indicators; Push remains available through [N05](#n05). In the Log branch tree, a single click selects a group or branch, a double click expands/collapses a group or loads a branch's history, and a single click on a commit loads its details. Disposable-repository checks covered comparison states; installed pointer checks verified these interactions, arrow visibility and commit-detail identity.

### 07. Log, filters and navigation

IDEA: [I1], [I6], [I7]. Patchwork: [P9], [P11].

| IntelliJ IDEA Git capability | Our Obsidian Patchwork Git implementation | Completion | Daily-use frequency |
| --- | --- | --- | --- |
| <a id="l01"></a>**L01** Commit graph and history table | History table and merge graph with incremental loading and continuation edges for parents beyond the loaded page. | 100% | 85|
| <a id="l02"></a>**L02** Multiple Log and file-history tabs | Tab host and path-scoped history. | <span style="color: #F57E84;">75%</span> | 45|
| <a id="l03"></a>**L03** Branch dashboard show/hide/resize | Implemented with persisted sizing. | <span style="color: #F57E84;">75%</span> | 65|
| <a id="l04"></a>**L04** Branch filter | Single reference and all branches. | <span style="color: #F57E84;">75%</span> | 75|
| <a id="l05"></a>**L05** Navigate to branch head | Toolbar action; full on-selection options missing. | <span style="color: #F57E84;">75%</span> | 60|
| <a id="l06"></a>**L06** Independent navigate/filter-on-selection settings | Selection drives filtering; separate preferences absent. | <span style="color: #F57E84;">50%</span> | 50|
| <a id="l07"></a>**L07** Message text/regex/case filter | Controls and backend options. | <span style="color: #F57E84;">75%</span> | 70|
| <a id="l08"></a>**L08** Author filter | Matching exists; aliases/picker incomplete. | <span style="color: #F57E84;">75%</span> | 40|
| <a id="l09"></a>**L09** Date filter | Relative since presets; full start/end range absent. | <span style="color: #F57E84;">50%</span> | 50|
| <a id="l10"></a>**L10** File/path filter | Single/multiple path scoping. | <span style="color: #F57E84;">75%</span> | 75|
| <a id="l11"></a>**L11** Repository/root filter |  | <span style="color: #F57E84;">0%</span> | 15|
| <a id="l12"></a>**L12** Compound branch/range inclusion/exclusion | Single-ref selection; no compound filter builder. | <span style="color: #F57E84;">25%</span> | 25|
| <a id="l13"></a>**L13** Favorites filter | Favorite branches exist; Favorites filter disabled. | <span style="color: #F57E84;">25%</span> | 25|
| <a id="l14"></a>**L14** Go to hash/reference/HEAD | Dedicated navigation. | 100% | 70|
| <a id="l15"></a>**L15** Sort order | Topology/date/reverse; not all graph layouts. | <span style="color: #F57E84;">75%</span> | 25|
| <a id="l16"></a>**L16** Show/hide author/date columns and details | Persisted controls. | 100% | 40|
| <a id="l17"></a>**L17** Collapse/fold graph branches and graph navigation |  | <span style="color: #F57E84;">0%</span> | 20|
| <a id="l18"></a>**L18** Semantic highlighting: current user/branch/cherry-picked | Reference/selection styling only; specialized highlighting incomplete. | <span style="color: #F57E84;">25%</span> | 30|
| <a id="l19"></a>**L19** Persistent indexed search / large history | Native queries and caches; no IDEA index. | <span style="color: #F57E84;">25%</span> | 65|
| <a id="l20"></a>**L20** Commit details and containing branches | Commit message, author/email/date, copyable full hash, HTTP(S) links and clickable containing branches. | 100% | 85|
| <a id="l21"></a>**L21** Changed-files tree/grouping/selection/Diff | Grouped/flat changed-file tree, multi/range/keyboard selection, persistent grouping and selected-file Diff. | 100% | 85|
| <a id="l22"></a>**L22** Compare two selected commits | Exactly-two selection supported. | 100% | 50|
| <a id="l23"></a>**L23** Copy hash and commit message | Both context actions. | 100% | 60|
| <a id="l24"></a>**L24** Browse whole repository at revision |  | <span style="color: #F57E84;">0%</span> | 20|
| <a id="l25"></a>**L25** Show current Log filter as Git command |  | <span style="color: #F57E84;">0%</span> | 5|
| <a id="l26"></a>**L26** Refresh and operation invalidation | Refresh controls and history invalidation. | 100% | 75|

### 08. History editing and interactive rebase

IDEA: [I1], [I8]. Patchwork: [P11], [P12].

| IntelliJ IDEA Git capability | Our Obsidian Patchwork Git implementation | Completion | Daily-use frequency |
| --- | --- | --- | --- |
| <a id="h01"></a>**H01** Cherry-pick one commit | Log action; merge commits excluded. | <span style="color: #F57E84;">75%</span> | 25|
| <a id="h02"></a>**H02** Cherry-pick several commits | Batch action and native recovery. | <span style="color: #F57E84;">75%</span> | 15|
| <a id="h03"></a>**H03** Revert one/several commits | Log actions; merge-parent selection absent. | <span style="color: #F57E84;">75%</span> | 35|
| <a id="h04"></a>**H04** Revert selected files from commit | Reverse patch; does not edit the historical commit itself. | <span style="color: #F57E84;">75%</span> | 20|
| <a id="h05"></a>**H05** Reset HEAD modes | Reset dialog; hard reset requires clean worktree. | <span style="color: #F57E84;">75%</span> | 25|
| <a id="h06"></a>**H06** Uncommit with changelist restoration | Reset available; dedicated Uncommit workflow absent. | <span style="color: #F57E84;">25%</span> | 35|
| <a id="h07"></a>**H07** Direct Log reword | Possible via interactive rebase, not dedicated action. | <span style="color: #F57E84;">50%</span> | 30|
| <a id="h08"></a>**H08** Direct Log squash | Via rebase plan, not direct Log workflow. | <span style="color: #F57E84;">50%</span> | 25|
| <a id="h09"></a>**H09** Direct Log drop commits | Via rebase plan, not direct Log workflow. | <span style="color: #F57E84;">50%</span> | 15|
| <a id="h10"></a>**H10** Drop selected changes from historical commit |  | <span style="color: #F57E84;">0%</span> | 8|
| <a id="h11"></a>**H11** Extract selected changes into historical commit |  | <span style="color: #F57E84;">0%</span> | 6|
| <a id="h12"></a>**H12** Interactive rebase plan | Range/root selection, table and native execution. | <span style="color: #F57E84;">75%</span> | 25|
| <a id="h13"></a>**H13** Pick/edit/reword/squash/fixup/drop | All six for linear plans. | 100% | 25|
| <a id="h14"></a>**H14** Multi-select/reorder plan rows | Ctrl/Cmd, Shift, keyboard and relative-order preservation. | 100% | 15|
| <a id="h15"></a>**H15** Combined squash message/body/trailers | Editable combined message; fixup message excluded. | 100% | 20|
| <a id="h16"></a>**H16** Reset plan actions/order/messages | Reset Actions restores loaded plan. | 100% | 8|
| <a id="h17"></a>**H17** Merge-preserving interactive rebase | Native topology preserved; merge Pick/Reword only, reorder/fold disabled. | <span style="color: #F57E84;">50%</span> | 8|
| <a id="h18"></a>**H18** Autosquash fixup/squash commits |  | <span style="color: #F57E84;">0%</span> | 12|
| <a id="h19"></a>**H19** Advanced onto/update-refs/exec/empty policies | Basic range and merge preservation only. | <span style="color: #F57E84;">25%</span> | 5|
| <a id="h20"></a>**H20** Edit stop/amend/continue/skip/abort | Native controls and dedicated amend action. | <span style="color: #F57E84;">75%</span> | 20|
| <a id="h21"></a>**H21** History rewrite recovery | Backup refs exist; complete undo/recovery UI absent. | <span style="color: #F57E84;">75%</span> | 10|
| <a id="h22"></a>**H22** Continue failed message amendment after hook failure | Exec rescheduling verified in disposable repository. | 100% | 6|

### 09. Diff, file history and annotations

IDEA: [I3], [I7], shared Diff infrastructure. Patchwork: [P7], [P11], [P13].

| IntelliJ IDEA Git capability | Our Obsidian Patchwork Git implementation | Completion | Daily-use frequency |
| --- | --- | --- | --- |
| <a id="d01"></a>**D01** Unified/side-by-side Diff | Unified and side-by-side views, navigation, wrapping/context preferences and working-file line navigation. | 100% | 95|
| <a id="d02"></a>**D02** Line/word changes and syntax rendering | Line and word differences retain syntax coloring in both layouts, with safe text rendering and bounded large-line highlighting. | 100% | 90|
| <a id="d03"></a>**D03** Previous/next hunk and file navigation | Toolbar controls. | 100% | 80|
| <a id="d04"></a>**D04** Compact/full context and line wrapping | Controls implemented. | 100% | 70|
| <a id="d05"></a>**D05** Whitespace comparison modes |  | <span style="color: #F57E84;">0%</span> | 40|
| <a id="d06"></a>**D06** Synchronized editable Diff panes | Read-oriented panes; hunk actions only. | <span style="color: #F57E84;">25%</span> | 45|
| <a id="d07"></a>**D07** Binary/image visual comparison | Binary backend support; visual comparator absent. | <span style="color: #F57E84;">25%</span> | 25|
| <a id="d08"></a>**D08** Compare local file to revision | Revision comparison with path scope. | <span style="color: #F57E84;">75%</span> | 65|
| <a id="d09"></a>**D09** File history across renames | Single-path history uses git log --follow; multi-path and full IDEA history navigation remain limited. | <span style="color: #F57E84;">75%</span> | 70|
| <a id="d10"></a>**D10** Directory history | Directory path filtering. | <span style="color: #F57E84;">75%</span> | 50|
| <a id="d11"></a>**D11** Historical file editor | Historical Diff/restore only. | <span style="color: #F57E84;">50%</span> | 35|
| <a id="d12"></a>**D12** Restore file from revision | Guarded restore; deletion/editor cases limited. | <span style="color: #F57E84;">75%</span> | 45|
| <a id="d13"></a>**D13** Annotate/blame lines | Separate dialog with author/hash and comparison. | <span style="color: #F57E84;">50%</span> | 45|
| <a id="d14"></a>**D14** Inline gutter blame and options |  | <span style="color: #F57E84;">0%</span> | 40|
| <a id="d15"></a>**D15** Line/selection history |  | <span style="color: #F57E84;">0%</span> | 25|
| <a id="d16"></a>**D16** Editor changed-line gutter and rollback | Markdown and standalone Code Editor changed-line gutters, before/after preview and undoable rollback; stale/read-only targets are rejected. Encrypted, binary and oversized baselines are excluded. | 100% | 85|
| <a id="d17"></a>**D17** External diff/merge tools |  | <span style="color: #F57E84;">0%</span> | 12|
| <a id="d18"></a>**D18** Copy repository-relative path | Absolute path/name copying only. | <span style="color: #F57E84;">25%</span> | 35|

### 10. Conflicts and interrupted operations

IDEA: [I1], [I3]. Patchwork: [P14].

| IntelliJ IDEA Git capability | Our Obsidian Patchwork Git implementation | Completion | Daily-use frequency |
| --- | --- | --- | --- |
| <a id="o01"></a>**O01** Detect externally started operations | Native marker discovery and state guards. | <span style="color: #F57E84;">75%</span> | 30|
| <a id="o02"></a>**O02** List conflicts / mark resolved | Commit entries and marker checks. | <span style="color: #F57E84;">75%</span> | 40|
| <a id="o03"></a>**O03** Base/ours/theirs and editable result | Textareas and result editor; not IDEA merge engine. | <span style="color: #F57E84;">50%</span> | 30|
| <a id="o04"></a>**O04** Accept whole-file ours/theirs | Dialog version selection; some deletion/binary cases excluded. | <span style="color: #F57E84;">50%</span> | 30|
| <a id="o05"></a>**O05** Accept individual blocks / auto-merge nonconflicting blocks |  | <span style="color: #F57E84;">0%</span> | 30|
| <a id="o06"></a>**O06** Dedicated rename/delete/binary conflict handling | Some cases require manual editor/explorer/Git actions. | <span style="color: #F57E84;">25%</span> | 12|
| <a id="o07"></a>**O07** Finish/abort merge | Native operation controls. | <span style="color: #F57E84;">75%</span> | 25|
| <a id="o08"></a>**O08** Continue/abort cherry-pick | Native controls; sequencer UX incomplete. | <span style="color: #F57E84;">75%</span> | 12|
| <a id="o09"></a>**O09** Continue/abort revert | Native controls. | <span style="color: #F57E84;">75%</span> | 10|
| <a id="o10"></a>**O10** Continue/skip/abort rebase | Native controls and state-token validation. | <span style="color: #F57E84;">75%</span> | 20|
| <a id="o11"></a>**O11** Revert/reopen resolved conflicts |  | <span style="color: #F57E84;">0%</span> | 8|
| <a id="o12"></a>**O12** Safe merge-result save | Backup/stale-content checks; only supported closed editor files. | <span style="color: #F57E84;">75%</span> | 30|

### 11. Stashes, shelves and patches

IDEA: [I1], [I3]. Patchwork: [P15], [P1], [P5].

| IntelliJ IDEA Git capability | Our Obsidian Patchwork Git implementation | Completion | Daily-use frequency |
| --- | --- | --- | --- |
| <a id="t01"></a>**T01** Stash all changes | Named stash including untracked files. | <span style="color: #F57E84;">75%</span> | 45|
| <a id="t02"></a>**T02** Stash selected paths | File action; option coverage incomplete. | <span style="color: #F57E84;">75%</span> | 30|
| <a id="t03"></a>**T03** Stash silently | Prompt/confirmation flow; dedicated silent action absent. | <span style="color: #F57E84;">25%</span> | 20|
| <a id="t04"></a>**T04** List/refresh stashes | Manager list and refresh. | 100% | 35|
| <a id="t05"></a>**T05** Preview stash | Diff tab; integrated tree/split preview absent. | <span style="color: #F57E84;">75%</span> | 30|
| <a id="t06"></a>**T06** Apply stash and keep it | Hash-based apply with index restoration. | 100% | 40|
| <a id="t07"></a>**T07** Pop stash |  | <span style="color: #F57E84;">0%</span> | 30|
| <a id="t08"></a>**T08** Unstash as branch |  | <span style="color: #F57E84;">0%</span> | 8|
| <a id="t09"></a>**T09** Drop stash | Confirmation and hash revalidation. | 100% | 25|
| <a id="t10"></a>**T10** Clear all stashes |  | <span style="color: #F57E84;">0%</span> | 5|
| <a id="t11"></a>**T11** Dedicated Stash tab and split preview |  | <span style="color: #F57E84;">0%</span> | 25|
| <a id="t12"></a>**T12** Shelve selected changes | Binary-safe local shelves; untracked/conflicts restricted, unstaged moves require staging. | <span style="color: #F57E84;">50%</span> | 25|
| <a id="t13"></a>**T13** Unshelve | Whole-shelf restore; partial/conflict workflow limited. | <span style="color: #F57E84;">75%</span> | 25|
| <a id="t14"></a>**T14** Shelf preview/rename/delete/import/partial restore |  | <span style="color: #F57E84;">0%</span> | 15|
| <a id="t15"></a>**T15** Create/export patch | Selected patch copying; full export wizard absent. | <span style="color: #F57E84;">50%</span> | 12|
| <a id="t16"></a>**T16** Apply patch file/clipboard with review UI |  | <span style="color: #F57E84;">0%</span> | 10|
| <a id="t17"></a>**T17** Local History alongside Git |  | <span style="color: #F57E84;">0%</span> | 55|

### 12. Tags, worktrees and submodules

IDEA: [I1], [I2]. Patchwork: [P16], [P17], [P3].

| IntelliJ IDEA Git capability | Our Obsidian Patchwork Git implementation | Completion | Daily-use frequency |
| --- | --- | --- | --- |
| <a id="w01"></a>**W01** Create lightweight/annotated tags | Revision, annotation and conditional Force. | 100% | 20|
| <a id="w02"></a>**W02** List/show/hide tags | Manager and branch-tree settings. | <span style="color: #F57E84;">75%</span> | 25|
| <a id="w03"></a>**W03** Push selected tag | Remote selection and confirmation. | 100% | 15|
| <a id="w04"></a>**W04** Push all tags / push policies |  | <span style="color: #F57E84;">0%</span> | 8|
| <a id="w05"></a>**W05** Delete local/remote tags | Both actions and checks. | <span style="color: #F57E84;">75%</span> | 8|
| <a id="w06"></a>**W06** Checkout/compare tag | Manager actions. | 100% | 25|
| <a id="w07"></a>**W07** Create worktree from reference | New branch and target directory. | <span style="color: #F57E84;">75%</span> | 15|
| <a id="w08"></a>**W08** Worktree for existing branch / detached revision | Dialog requires new branch. | <span style="color: #F57E84;">25%</span> | 12|
| <a id="w09"></a>**W09** List/refresh worktrees | Native porcelain list. | 100% | 12|
| <a id="w10"></a>**W10** Lock/unlock worktrees | Both actions. | 100% | 4|
| <a id="w11"></a>**W11** Remove worktree | Dirty/locked removal refused; force workflow absent. | <span style="color: #F57E84;">75%</span> | 10|
| <a id="w12"></a>**W12** Prune worktree records | Dry-run preview and confirmation. | 100% | 4|
| <a id="w13"></a>**W13** Open worktree as IDE project/window | Opens system folder, not an Obsidian vault/window. | <span style="color: #F57E84;">25%</span> | 12|
| <a id="w14"></a>**W14** Open worktree's code review |  | <span style="color: #F57E84;">0%</span> | 4|
| <a id="w15"></a>**W15** Worktree tool-window/dashboard | Manager dialog only. | <span style="color: #F57E84;">50%</span> | 10|
| <a id="w16"></a>**W16** Discover/open submodule repository | Lists .gitmodules paths and switches active root. | <span style="color: #F57E84;">75%</span> | 12|
| <a id="w17"></a>**W17** Recursive submodule initialize/update | Selected update --init --recursive. | 100% | 15|
| <a id="w18"></a>**W18** Submodule add/remove/sync/branch settings |  | <span style="color: #F57E84;">0%</span> | 5|
| <a id="w19"></a>**W19** Submodule pointer status and commit | Native status/commit; specialized Diff/UI incomplete. | <span style="color: #F57E84;">50%</span> | 15|

### 13. Islands Dark presentation and interaction

IDEA: [I3], [I6], [I7], [I9]. Patchwork: [P5], [P7], [P8], [P9], [P18].

| IntelliJ IDEA Git capability | Our Obsidian Patchwork Git implementation | Completion | Daily-use frequency |
| --- | --- | --- | --- |
| <a id="u01"></a>**U01** Commit/Git tool-window icons | Namespaced official dark Commit/Git tool-window assets, mounted through the Borders public panel contract. | 100% | 100|
| <a id="u02"></a>**U02** Action icons and conditional visibility/enabling | Available Git controls use namespaced source-mapped artwork and selection, staging-side, busy, conflict, tracking, operation and window capability guards. | 100% | 95|
| <a id="u03"></a>**U03** Islands panel/border/selection palette | Git-owned Islands Dark surfaces, selection colors and one-pixel visible dividers; Commit Details is #191A1C. | 100% | 100|
| <a id="u04"></a>**U04** Commit Details background #191A1C | Installed computed color verified. | 100% | 80|
| <a id="u05"></a>**U05** Origin text normal foreground after filename | Installed #D1D3D9 and weight 400 verified. | 100% | 65|
| <a id="u06"></a>**U06** Typography, row height and spacing | Reference 12px Microsoft YaHei UI text, compact spacing and 30px history rows; toolbar/tree artwork keeps its original 16px canvas. | 100% | 100|
| <a id="u07"></a>**U07** Thin separators and resizable panels | Thin line/wider hit area and persisted dimensions. | <span style="color: #F57E84;">75%</span> | 70|
| <a id="u08"></a>**U08** Menu order, shortcuts and tooltips | Source-mapped menu groups, configurable Obsidian commands, scoped Commit/Diff shortcuts, keyboard context menus and descriptive action tooltips. | 100% | 85|
| <a id="u09"></a>**U09** Keyboard/focus/multi-selection/accessibility | Keyboard navigation, range/multiple selection, context menus, focus restoration, accessible tree/list/tab state and keyboard/pointer splitters across Commit, Log and Diff. | 100% | 80|
| <a id="u10"></a>**U10** Popout window operation targeting | Context guards; some operations unavailable outside main window. | <span style="color: #F57E84;">50%</span> | 25|
| <a id="u11"></a>**U11** Persisted layouts/filters/preferences | Persisted Commit layout/grouping/path options, repository drafts, Log tabs/active tab/filters/branch visibility and Diff presentation; popout tab storage is isolated from the main window. | 100% | 85|
| <a id="u12"></a>**U12** Customizable toolbars and action/keymap system | Subset of Obsidian commands/hotkeys. | <span style="color: #F57E84;">25%</span> | 25|
| <a id="u13"></a>**U13** Notifications/progress/cancellation framework | Git uses Borders background progress for Fetch, Update, Push, Commit and serialized operations, with completion/error/unload cleanup and provider replacement. Continuous animation; Fetch/Clone X controls cancel the owned Git process tree. The popup minus button only minimizes. Merge/rebase cancellation remains separate. | <span style="color: #F57E84;">75%</span> | 75|

### 14. Optional hosting integrations

IDEA: optional GitHub/GitLab integrations [I10]. Patchwork: [P2]. Excluded from core average.

| IntelliJ IDEA Git capability | Our Obsidian Patchwork Git implementation | Completion | Daily-use frequency |
| --- | --- | --- | --- |
| <a id="e01"></a>**E01** Open hosted repository in browser | Open origin on GitHub only. | <span style="color: #F57E84;">50%</span> | 35|
| <a id="e02"></a>**E02** Open/copy remote file/line/revision/branch links |  | <span style="color: #F57E84;">0%</span> | 40|
| <a id="e03"></a>**E03** GitHub/GitLab account management |  | <span style="color: #F57E84;">0%</span> | 12|
| <a id="e04"></a>**E04** Share project / create hosted repository |  | <span style="color: #F57E84;">0%</span> | 8|
| <a id="e05"></a>**E05** Pull/merge request lists and review UI |  | <span style="color: #F57E84;">0%</span> | 30|
| <a id="e06"></a>**E06** Create review, comment, approve and merge |  | <span style="color: #F57E84;">0%</span> | 25|
| <a id="e07"></a>**E07** Review checkout and associated worktrees |  | <span style="color: #F57E84;">0%</span> | 10|
| <a id="e08"></a>**E08** Provider protection/review status |  | <span style="color: #F57E84;">0%</span> | 30|

## Interpretation of the most important gaps

1. **File moves:** new observed vault moves synchronize tracked paths with the real index. Old/unobserved moves use similarity-based display detection. Cross-root moves and IDEA add/remove policy settings are not implemented. Neither Git nor Patchwork stores a directory-rename object independently of its files.
2. **Staging and partial commits:** staged commits and private-index checked-file commits exist. This is not the full IDEA staging-area tree, arbitrary-line selection or simultaneous HEAD/index/working-tree editor.
3. **History rewriting:** linear interactive rebase is substantially implemented. Direct Log editing, extraction/drop of selected historical changes, autosquash and unrestricted merge-plan manipulation remain incomplete or absent.
4. **Conflict handling:** selecting a full side and editing a result textarea do not equal IDEA's conflict-block merge editor. Binary/deletion/rename conflict cases still have material gaps.
5. **Remote operations:** normal fetch/update/push exist, but force push, selected-commit push, rejection recovery, provider authentication and server protection synchronization are not complete.
6. **Presentation:** official SVG mappings and several exact values were corrected. This does not close the full typography, action-state, menu, keyboard and scaling matrix.

The existing safe restrictions are described as parity gaps rather than silently treated as complete: clean-worktree Hard Reset, disabled merge-plan reorder/fold, staging prerequisites for shelving moves, and unavailable popout operations.

## Validation boundary

This document was produced by source/action inventory review. No new runtime feature tests, builds, installations, repository mutations or commits are required for this documentation task.

Earlier work in this session supplied selected evidence: temporary-repository verification of moves, stage/unstage/checked-file commits, rebase messages and merge topology; installed-class checks for move synchronization; and runtime CSS checks for moved-from text and Commit Details background. These checks do **not** validate all 256 rows.

Scores should be revised when implementation or evidence changes. A source-level implementation is distinguished from end-to-end acceptance; missing-runtime evidence is not converted into a fabricated success claim.

## Registered Git action crosswalk

The following crosswalk is generated from the pinned Git backend/frontend/shared XML registrations, not from memory. Multiple action IDs may map to one feature row. It provides a completeness check for explicitly registered actions; it does not replace the broader shared-platform feature inventory.

| IDEA registered action ID | Comparison row | Completion of referenced capability | Daily-use frequency |
| --- | --- | --- | --- |
| `Git.Init` | [R01](#r01) | 100% | 8 |
| `Git.Log` | [R08](#r08) | <span style="color: #F57E84;">25%</span> | 12 |
| `Git.BrowseRepoAtRevision` | [L24](#l24) | <span style="color: #F57E84;">0%</span> | 20 |
| `Git.CheckoutRevision` | [B12](#b12) | 100% | 20 |
| `Git.CreateNewBranch` | [B09](#b09) | 100% | 65 |
| `Git.CreateNewTag` | [W01](#w01) | 100% | 20 |
| `Git.PushUpToCommit` | [N08](#n08) | <span style="color: #F57E84;">0%</span> | 8 |
| `Git.Reset.In.Log` | [H05](#h05) | <span style="color: #F57E84;">75%</span> | 25 |
| `Git.Revert.In.Log` | [H03](#h03) | <span style="color: #F57E84;">75%</span> | 35 |
| `Git.Uncommit` | [H06](#h06) | <span style="color: #F57E84;">25%</span> | 35 |
| `Git.Reword.Commit` | [H07](#h07) | <span style="color: #F57E84;">50%</span> | 30 |
| `Git.Squash.Commits` | [H08](#h08) | <span style="color: #F57E84;">50%</span> | 25 |
| `Git.Drop.Commits` | [H09](#h09) | <span style="color: #F57E84;">50%</span> | 15 |
| `Git.Show.WorkingTrees` | [W15](#w15) | <span style="color: #F57E84;">50%</span> | 10 |
| `Git.CreateNewWorkingTree` | [W07](#w07) | <span style="color: #F57E84;">75%</span> | 15 |
| `Git.Drop.Selected.Changes` | [H10](#h10) | <span style="color: #F57E84;">0%</span> | 8 |
| `Git.InMemory.Extract.Selected.Changes` | [H11](#h11) | <span style="color: #F57E84;">0%</span> | 6 |
| `Git.New.Branch.In.Log` | [B09](#b09) | 100% | 65 |
| `Git.Log.Branches.Change.Branch.Filter` | [L04](#l04) | <span style="color: #F57E84;">75%</span> | 75 |
| `Git.Log.Branches.Navigate.Log.To.Selected.Branch` | [L05](#l05) | <span style="color: #F57E84;">75%</span> | 60 |
| `Git.Log.Hide.Branches` | [L03](#l03) | <span style="color: #F57E84;">75%</span> | 65 |
| `Git.Log.Branches.Change.Branch.Filter.On.Selection` | [L06](#l06) | <span style="color: #F57E84;">50%</span> | 50 |
| `Git.Log.Branches.Navigate.Log.To.Branch.On.Selection` | [L06](#l06) | <span style="color: #F57E84;">50%</span> | 50 |
| `Git.Fixup.To.Commit` | [C24](#c24) | <span style="color: #F57E84;">0%</span> | 12 |
| `Git.Squash.Into.Commit` | [C24](#c24) | <span style="color: #F57E84;">0%</span> | 12 |
| `Git.Interactive.Rebase` | [H12](#h12) | <span style="color: #F57E84;">75%</span> | 25 |
| `Git.Commit.And.Push.Executor` | [C07](#c07) | 100% | 90 |
| `Git.Add` | [F14](#f14) | 100% | 90 |
| `Git.CompareWithBranch` | [B20](#b20) | <span style="color: #F57E84;">75%</span> | 60 |
| `Git.Cleanup.Branches` | [B25](#b25) | <span style="color: #F57E84;">0%</span> | 15 |
| `Git.Rebase.Abort` | [O10](#o10) | <span style="color: #F57E84;">75%</span> | 20 |
| `Git.Rebase.Continue` | [O10](#o10) | <span style="color: #F57E84;">75%</span> | 20 |
| `Git.Rebase.Skip` | [O10](#o10) | <span style="color: #F57E84;">75%</span> | 20 |
| `Git.Merge.Commit` | [O07](#o07) | <span style="color: #F57E84;">75%</span> | 25 |
| `Git.Merge.Abort` | [O07](#o07) | <span style="color: #F57E84;">75%</span> | 25 |
| `Git.Stash` | [T01](#t01) | <span style="color: #F57E84;">75%</span> | 45 |
| `Git.Unstash` | [T06](#t06) | 100% | 40 |
| `Git.Pull` | [N03](#n03) | 100% | 90 |
| `Git.Fetch` | [N01](#n01) | 100% | 85 |
| `Git.Unshallow` | [R09](#r09) | <span style="color: #F57E84;">0%</span> | 4 |
| `Git.Merge` | [B16](#b16) | <span style="color: #F57E84;">75%</span> | 55 |
| `Git.Rebase` | [B17](#b17) | <span style="color: #F57E84;">75%</span> | 40 |
| `Git.ResolveConflicts` | [O03](#o03) | <span style="color: #F57E84;">50%</span> | 30 |
| `Git.RevertResolved` | [O11](#o11) | <span style="color: #F57E84;">0%</span> | 8 |
| `Git.Branches` | [B01](#b01) | 100% | 95 |
| `Git.Tag` | [W01](#w01) | 100% | 20 |
| `Git.Reset` | [H05](#h05) | <span style="color: #F57E84;">75%</span> | 25 |
| `Git.Configure.Remotes` | [R14](#r14) | <span style="color: #F57E84;">75%</span> | 15 |
| `Git.Clone` | [R02](#r02) | <span style="color: #F57E84;">75%</span> | 20 |
| `Git.Revert.Abort` | [O09](#o09) | <span style="color: #F57E84;">75%</span> | 10 |
| `Git.CherryPick.Continue` | [O08](#o08) | <span style="color: #F57E84;">75%</span> | 12 |
| `Git.CherryPick.Abort` | [O08](#o08) | <span style="color: #F57E84;">75%</span> | 12 |
| `git.update.force.pushed.branch` | [B26](#b26) | <span style="color: #F57E84;">0%</span> | 8 |
| `Git.FindMergedLocalBranches` | [B24](#b24) | <span style="color: #F57E84;">0%</span> | 15 |
| `Git.PrefillRecentPushTargets` | [N11](#n11) | <span style="color: #F57E84;">25%</span> | 50 |
| `Git.Ref.Compare.With` | [B20](#b20) | <span style="color: #F57E84;">75%</span> | 60 |
| `Git.Ref.Diff.With.Local` | [B20](#b20) | <span style="color: #F57E84;">75%</span> | 60 |
| `Git.Rename.Local.Branch` | [B13](#b13) | 100% | 20 |
| `Git.Tag.Push` | [W03](#w03) | 100% | 15 |
| `Git.ShowBranches` | [B01](#b01) | 100% | 95 |
| `Git.Toolbar.ShowMoreActions` | [U12](#u12) | <span style="color: #F57E84;">25%</span> | 25 |
| `Git.Log.Show.Command` | [L25](#l25) | <span style="color: #F57E84;">0%</span> | 5 |
| `Git.AddCommitToRemoteBranch` | [N10](#n10) | <span style="color: #F57E84;">0%</span> | 5 |
| `Git.PushSelectedCommits` | [N09](#n09) | <span style="color: #F57E84;">0%</span> | 6 |
| `Git.CreateNewBranch.FromCommit` | [B09](#b09) | 100% | 65 |
| `Git.Log.HighlightCherryPickedCommits` | [L18](#l18) | <span style="color: #F57E84;">25%</span> | 30 |
| `Git.OpenExcludeFile` | [F17](#f17) | <span style="color: #F57E84;">0%</span> | 10 |
| `git4idea.commands.TestGitHttpLoginDialogAction` | Internal authentication test action; excluded from product inventory | Not scored | Not scored |
| `CopyPathFromRepositoryRootProvider` | [D18](#d18) | <span style="color: #F57E84;">25%</span> | 35 |
| `Git.Show.Stage` | [S01](#s01) | <span style="color: #F57E84;">50%</span> | 20 |
| `Git.Commit.Stage` | [S12](#s12) | 100% | 80 |
| `Git.Stage.Enable` | [S01](#s01) | <span style="color: #F57E84;">50%</span> | 20 |
| `Git.Stage.Disable` | [S01](#s01) | <span style="color: #F57E84;">50%</span> | 20 |
| `Git.Stage.Add` | [S02](#s02) | 100% | 90 |
| `Git.Stage.Add.No.Content` | [S05](#s05) | <span style="color: #F57E84;">0%</span> | 8 |
| `Git.Stage.Reset` | [S03](#s03) | 100% | 65 |
| `Git.Stage.Revert` | [F12](#f12) | <span style="color: #F57E84;">75%</span> | 60 |
| `Git.Stage.AcceptTheirs` | [O04](#o04) | <span style="color: #F57E84;">50%</span> | 30 |
| `Git.Stage.AcceptYours` | [O04](#o04) | <span style="color: #F57E84;">50%</span> | 30 |
| `Git.Stage.Merge` | [O03](#o03) | <span style="color: #F57E84;">50%</span> | 30 |
| `Git.Stage.ThreeSideDiff` | [O03](#o03) | <span style="color: #F57E84;">50%</span> | 30 |
| `Git.Stage.ToggleIgnored` | [F18](#f18) | <span style="color: #F57E84;">25%</span> | 20 |
| `Git.Stage.ToggleCommitAll` | [S12](#s12) | 100% | 80 |
| `Git.Stage.Add.All` | [S04](#s04) | <span style="color: #F57E84;">50%</span> | 65 |
| `Git.Stage.Add.Tracked` | [S04](#s04) | <span style="color: #F57E84;">50%</span> | 65 |
| `Git.Stage.Show.Staged` | [S10](#s10) | <span style="color: #F57E84;">0%</span> | 20 |
| `Git.Stage.Show.Local` | [S11](#s11) | 100% | 85 |
| `Git.Stage.Compare.Local.Staged` | [S08](#s08) | 100% | 75 |
| `Git.Stage.Compare.Staged.Local` | [S08](#s08) | 100% | 75 |
| `Git.Stage.Compare.Staged.Head` | [S08](#s08) | 100% | 75 |
| `Git.Stage.Compare.Three.Versions` | [S09](#s09) | <span style="color: #F57E84;">0%</span> | 25 |
| `Git.Stage.Stash.Files` | [S13](#s13) | <span style="color: #F57E84;">50%</span> | 25 |
| `Git.ChangesView.Merge` | [O03](#o03) | <span style="color: #F57E84;">50%</span> | 30 |
| `Git.ChangesView.AcceptTheirs` | [O04](#o04) | <span style="color: #F57E84;">50%</span> | 30 |
| `Git.ChangesView.AcceptYours` | [O04](#o04) | <span style="color: #F57E84;">50%</span> | 30 |
| `Git.Stash.Silently` | [T03](#t03) | <span style="color: #F57E84;">25%</span> | 20 |
| `Git.Stash.Pop` | [T07](#t07) | <span style="color: #F57E84;">0%</span> | 30 |
| `Git.Stash.Apply` | [T06](#t06) | 100% | 40 |
| `Git.Stash.UnstashAs` | [T08](#t08) | <span style="color: #F57E84;">0%</span> | 8 |
| `Git.Stash.Drop` | [T09](#t09) | 100% | 25 |
| `Git.Stash.Clear` | [T10](#t10) | <span style="color: #F57E84;">0%</span> | 5 |
| `Git.Show.Stash` | [T11](#t11) | <span style="color: #F57E84;">0%</span> | 25 |
| `Git.Stash.Refresh` | [T04](#t04) | 100% | 35 |
| `Git.Stash.Toggle.Split.Preview` | [T11](#t11) | <span style="color: #F57E84;">0%</span> | 25 |
| `main.toolbar.git.MergeRebase` | [O01](#o01) | <span style="color: #F57E84;">75%</span> | 30 |
| `gpg.agent.configuration` | [R12](#r12) | <span style="color: #F57E84;">0%</span> | 4 |
| `Git.Branches.Popup.Fetch` | [N01](#n01) | 100% | 85 |
| `Git.WorkingTrees.Remove` | [W11](#w11) | <span style="color: #F57E84;">75%</span> | 10 |
| `Git.WorkingTrees.Open` | [W13](#w13) | <span style="color: #F57E84;">25%</span> | 12 |
| `Git.WorkingTrees.Refresh` | [W09](#w09) | 100% | 12 |
| `Git.WorkingTrees.Prune` | [W12](#w12) | 100% | 4 |
| `Git.WorkingTrees.ToggleLock` | [W10](#w10) | 100% | 4 |
| `Git.WorkingTrees.OpenReview` | [W14](#w14) | <span style="color: #F57E84;">0%</span> | 4 |
| `main.toolbar.git.Branches` | [B01](#b01) | 100% | 95 |
| `git.branches.show.tags` | [B07](#b07) | <span style="color: #F57E84;">50%</span> | 30 |
| `git.branches.popup.filter.by.action` | [B06](#b06) | <span style="color: #F57E84;">0%</span> | 15 |
| `git.branches.popup.filter.by.repository` | [B05](#b05) | <span style="color: #F57E84;">0%</span> | 15 |
| `git.branches.group.by.directory` | [B04](#b04) | 100% | 45 |
| `git.branches.group.by.repository` | [B05](#b05) | <span style="color: #F57E84;">0%</span> | 15 |
| `git.branches.show.recent` | [B07](#b07) | <span style="color: #F57E84;">50%</span> | 30 |
| `git.branches.popup.resize` | [B08](#b08) | 100% | 20 |
| `Git.Checkout.Update` | [B19](#b19) | <span style="color: #F57E84;">0%</span> | 25 |

## Evidence index

IDEA links are pinned to the audited revision. Patchwork links point to the current working-tree sources, so later changes can alter the evidence.

[I1]: https://github.com/JetBrains/intellij-community/tree/8eee455aa813af4ad427fd576b0ad8d94c418577/plugins/git4idea/backend/resources/intellij.vcs.git.backend.xml
[I2]: https://github.com/JetBrains/intellij-community/tree/8eee455aa813af4ad427fd576b0ad8d94c418577/plugins/git4idea/shared/resources/intellij.vcs.git.shared.xml
[I3]: https://github.com/JetBrains/intellij-community/tree/8eee455aa813af4ad427fd576b0ad8d94c418577/platform/vcs-impl/resources/META-INF/VcsActions.xml
[I4]: https://github.com/JetBrains/intellij-community/tree/8eee455aa813af4ad427fd576b0ad8d94c418577/platform/vcs-impl
[I5]: https://github.com/JetBrains/intellij-community/tree/8eee455aa813af4ad427fd576b0ad8d94c418577/plugins/git4idea/backend/src/vfs/GitVFSListener.java
[I6]: https://github.com/JetBrains/intellij-community/tree/8eee455aa813af4ad427fd576b0ad8d94c418577/plugins/git4idea/backend/src/ui/branch
[I7]: https://github.com/JetBrains/intellij-community/tree/8eee455aa813af4ad427fd576b0ad8d94c418577/platform/vcs-log/impl
[I8]: https://github.com/JetBrains/intellij-community/tree/8eee455aa813af4ad427fd576b0ad8d94c418577/plugins/git4idea/backend/src/rebase
[I9]: https://github.com/JetBrains/intellij-community/tree/8eee455aa813af4ad427fd576b0ad8d94c418577/platform/platform-resources
[I10]: https://github.com/JetBrains/intellij-community/tree/8eee455aa813af4ad427fd576b0ad8d94c418577/plugins

- [I1] Git backend action registrations: core commands, Log editing, staging, stashes, worktrees and optional integration entry points.
- [I2] Shared branch-popup action registrations. Also audited: [frontend registrations](https://github.com/JetBrains/intellij-community/tree/8eee455aa813af4ad427fd576b0ad8d94c418577/plugins/git4idea/frontend/resources/intellij.vcs.git.frontend.xml).
- [I3] Shared VCS/Commit action definitions.
- [I4] Shared Commit, changelist, shelf and file-operation infrastructure.
- [I5] Git file-move/index integration. Related: [VcsVFSListener](https://github.com/JetBrains/intellij-community/tree/8eee455aa813af4ad427fd576b0ad8d94c418577/platform/vcs-impl/src/com/intellij/openapi/vcs/VcsVFSListener.java), [GitFileUtils](https://github.com/JetBrains/intellij-community/tree/8eee455aa813af4ad427fd576b0ad8d94c418577/plugins/git4idea/backend/src/util/GitFileUtils.kt), [GitChangesCollector](https://github.com/JetBrains/intellij-community/tree/8eee455aa813af4ad427fd576b0ad8d94c418577/plugins/git4idea/backend/src/status/GitChangesCollector.java).
- [I6] Branch popup/dashboard implementation.
- [I7] VCS Log rendering, navigation and filters.
- [I8] Rebase and commit-editing implementation.
- [I9] Platform theme resources. The previously recorded Islands palette and icon audit are summarized in [Patchwork's interface reference](plugins/git/INTERFACE-REFERENCE.md).
- [I10] Optional GitHub/GitLab plugin sources. Hosting rows describe integration scope and do not assert an exhaustive provider-specific review-feature inventory.
- Origin presentation references: [ChangesBrowserChangeNode](https://github.com/JetBrains/intellij-community/tree/8eee455aa813af4ad427fd576b0ad8d94c418577/platform/vcs-impl/shared/src/com/intellij/openapi/vcs/changes/ui/ChangesBrowserChangeNode.java), [Change](https://github.com/JetBrains/intellij-community/tree/8eee455aa813af4ad427fd576b0ad8d94c418577/platform/vcs-api/vcs-api-core/src/com/intellij/openapi/vcs/changes/Change.java), [VcsBundle](https://github.com/JetBrains/intellij-community/tree/8eee455aa813af4ad427fd576b0ad8d94c418577/platform/vcs-api/vcs-api-core/resources/messages/VcsBundle.properties).

[P1]: plugins/git/src/repository.js
[P2]: plugins/git/src/file-context-actions.js
[P3]: plugins/git/src/repositories-modal.js
[P4]: plugins/git/src/move-tracker.js
[P5]: plugins/git/src/commit/commit-view.js
[P6]: plugins/git/src/changelists.js
[P7]: plugins/git/src/diff-view.js
[P8]: plugins/git/src/branch-actions.js
[P9]: plugins/git/src/log/git-log-pane.js
[P10]: plugins/git/src/network-modal.js
[P11]: plugins/git/src/history/menus.js
[P12]: plugins/git/src/rebase-modal.js
[P13]: plugins/git/src/blame-modal.js
[P14]: plugins/git/src/operations.js
[P15]: plugins/git/src/stash-modal.js
[P16]: plugins/git/src/tags-modal.js
[P17]: plugins/git/src/worktree-modal.js
[P18]: plugins/git/styles/islands.css

- [P1] Status, staging, checked-file commits, patch generation and index preservation.
- [P2] File/repository actions and limited GitHub browser integration; related [clone](plugins/git/src/clone-modal.js), [remotes](plugins/git/src/remotes-modal.js), [settings](plugins/git/src/settings.js).
- [P3] Active-root switching and submodule manager.
- [P4] Rename subscription/batching; [index transaction](plugins/git/src/utils/move-index.js), [detection fallback](plugins/git/src/utils/worktree-renames.js), [status snapshots](plugins/git/src/status.js).
- [P5] Commit rendering and controls; [context menu](plugins/git/src/commit/commit-context-menu.js), [file actions](plugins/git/src/commit/file-actions.js), [controller](plugins/git/src/controller.js).
- [P6] Changelist data and persistence.
- [P7] Diff controls/hunk operations; [rendering](plugins/git/src/history/utils/render-diff.js), [backend](plugins/git/src/history/git/git-service.ts), [comparison](plugins/git/src/compare-modal.js).
- [P8] Branch operations; [popup](plugins/git/src/header/git-popup.js), [protection](plugins/git/src/utils/branch-protection.js).
- [P9] Log filters/graph/details; [changed files](plugins/git/src/log/changed-files.js), [My Branches](plugins/git/src/log/utils/my-branches.js).
- [P11] Reachable history actions; unused backend methods alone do not establish UI completion.
- [P12] Interactive rebase; [plan](plugins/git/src/utils/rebase-plan.js), [todo/editor](plugins/git/src/utils/rebase-todo.js), [reset](plugins/git/src/reset-modal.js).
- [P14] Operation state/continuation; [conflict modal](plugins/git/src/conflict-modal.js).
- [P15] Stash manager; [shelf implementation](plugins/git/src/shelves.js).
- [P16] Tag manager.
- [P17] Worktree manager.
- [P18] Islands styling; [Commit CSS](plugins/git/styles/commit.css), [Log CSS](plugins/git/styles/log.css).

