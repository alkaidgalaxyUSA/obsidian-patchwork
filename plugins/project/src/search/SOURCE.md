# Search Everywhere source adaptation

Upstream: [JetBrains/intellij-community](https://github.com/JetBrains/intellij-community/tree/94e95f9d1785ba472e90d84b1a4ff56729ceabd5).
Pinned revision: `94e95f9d1785ba472e90d84b1a4ff56729ceabd5`.
Reviewed on 2026-11-05. The referenced source files carry Apache-2.0 headers.
The complete Apache license and attribution are embedded in `idea-matcher.js`
and retained in the distributed bundle by esbuild's legal-comment handling.

## Translated algorithms

Under `platform/util/text-matching/src/com/intellij/psi/codeStyle`:

- `MinusculeMatcherImpl.kt`: wildcard/word-boundary/camel-hump fragment matching,
  mixed-case handling, numeric fragments, dot barriers and uppercase preference.
- `MinusculeMatcher.kt`: fragment scoring, skipped humps and case bonuses.
- `PreferStartMatchMatcherWrapper.kt`: 10000-point start-match bonus.

`platform/util/base/src/com/intellij/util/text/NameUtilCore.kt` supplies word
boundaries and hump traversal. The JavaScript port uses Unicode properties and
UTF-16 highlight offsets. Only the case-insensitive matching mode is ported.
Long patterns use a contiguous meaningful-character fallback. Keyboard-layout
correction, transliteration and typo-tolerant wrappers are not ported.

Under `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere`:

- `AbstractGotoSEContributor.kt`: file-name navigation suffixes, adapted to
  positive line/column values and zero-based editor locations.
- `SearchHistoryList.kt` and `HistoryIterator.kt`: 50-entry contributor histories,
  deduplication, All history aggregation and circular previous/next traversal.
- `SearchEverywhereUI.java`: 15 results per contributor in All, 30 in individual
  tabs, More loading, stable existing results while loading more, category
  switching and selection-driven descriptions.
- `RecentFilesSEContributor.java`: recent-file ordering, empty-query results,
  exclusion of visible files for empty queries, and name matcher integration.
- `FileSearchEverywhereContributor.kt`: file-type filtering and navigation.
- `ActionSearchEverywhereContributor.kt`: action contributor integration,
  adapted to Obsidian registered commands and native availability checks.

`platform/lang-impl/src/com/intellij/find/impl/TextSearchContributor.kt` supplies
the reference for literal content search, case sensitivity and whole words.

## Runtime adaptations and limits

- Java/Swing UI, IntelliJ services, VFS and indexes cannot run inside Obsidian.
  The popup remains a scoped Obsidian Modal using Project-owned styles, vault
  reads and public document navigation services.
- Supported categories: All, Files, Actions and Text. Results are grouped by
  source; file results are deduplicated between Recent files and Files.
  Ranking uses the translated matcher with Obsidian recency and lexical ties,
  not IDEA's complete GotoFile path-proximity or machine-learning ranking.
- The filter toolbar is removed by user request; searches ignore case. Content search excludes
  encrypted, binary, unsupported and over-5-MiB files. There is no decrypted
  editor read or persistent text-content index. Search scope is vault-visible
  files, not IDEA project libraries, excluded roots or the whole filesystem.
- Actions execute only after explicit selection; unavailable commands report
  that result. IDEA settings and intentions are not Obsidian commands.
- Search history is session-local and cleared when Project unloads. Opening the
  popup restores/selects the latest query. Alt+Up/Down cycles category history.
- The user-requested hidden title, focus-only blue border, file-type icons,
  inline relative directory, absolute-path footer and brief selection before
  mouse navigation are retained. The 100ms mouse delay is a requested adaptation,
  not an upstream IDEA constant.
- The popup has a fixed 520px height (limited to 80% of the viewport), with 24px
  result rows and a scrolling result region. Empty space is retained for short
  result sets. Counts, group headings, separators and result tooltips are removed.
  File rows show the relative directory and right-aligned project identity;
  text rows show the matching snippet and right-aligned filename. The path footer
  sits 3px inside the bottom border. History remains available through the keyboard.
- Not ported: JVM PSI Classes/Symbols, preview pane, regex text mode, calculator,
  multi-selection, search scopes outside the vault, ML ranking, remote split
  backend and Find-tool-window export. This is a source-derived adaptation of
  supported contributors, not a claim of complete IDEA feature parity.

The pinned tree also contains a newer Split Search Everywhere under
`platform/searchEverywhere/{frontend,backend,shared}`; several classic classes
are marked deprecated there. This implementation deliberately identifies the
classic source baseline instead of conflating the two implementations.

## Validation

Inline checks cover camel-hump fragments, wildcard matching, start ranking,
line/column parsing, pagination, actions, repeated text matches, encrypted-file
exclusion, contributor deduplication, cancellation and history limits.
Syntax, TypeScript and module-boundary checks are run separately. Live checks
are required for popup interaction; static checks alone are not UI acceptance.
