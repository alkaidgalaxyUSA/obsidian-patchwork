# 1. Problem Summary

- **Reported issue:** Obsidian becomes unresponsive and CPU activity increases when rendering a large Markdown note in reading mode. Other documents do not exhibit the same behavior.
- **Affected file:** `D:\my-notes\999.Mysqlsh Log\2026-11-09.md`.
- **File size:** 1,660,647 bytes across 4,267 lines.
- **Dominant content:** A single fenced JSON code block at lines 25–4264, containing 4,238 content lines and 1,659,913 characters. The separate SQL block contains only 542 characters.
- **User request:** Remove the 1 MB preview protection, identify the specific cause, and report possible solutions before implementing a performance fix.
- **Current status:** The 1 MB protection has been removed. The Content plugin was built, installed, and reloaded. No performance fix has been implemented; solution selection remains pending.
- **Data preservation:** Diagnosis used copies in an isolated vault. The original note matched the diagnostic copy by file hash after investigation. Its tab was saved and closed before the plugin reload to avoid immediately triggering another freeze.
- **Scope of evidence:** The confirmed hotspot is in native reading-mode rendering. These measurements do not establish the behavior of every live-preview editing path.

# 2. Analysis Report

## Reproduction and Measurements

Diagnosis used Obsidian 1.15.0 in an isolated profile with the default theme and no third-party plugins. The same note still reproduced the rendering problem, demonstrating that Patchwork is not required to trigger it.

| Experiment | Observed result | Interpretation |
| --- | --- | --- |
| Open the original-content copy in native preview | Severe unresponsiveness reproduced | The native rendering path can trigger the issue independently of community plugins |
| Change only the copied block language from `json` to `text` | The full-size note remained responsive | Syntax-highlighted rendering is a decisive factor for this document |
| Run the extracted native Prism highlighter on the complete JSON block outside the UI | Approximately 442 ms; 245,689 generated `span` elements | Tokenization alone does not explain the prolonged freeze; its output creates a very large layout workload |
| Render a 100-line JSON sample, then wait for a one-second observation timer | Approximately 1,041 ms overall | The small sample did not materially delay the observation timer |
| Render a 500-line JSON sample using the same observation | Approximately 7,566 ms overall | The larger sample substantially blocked the UI thread; this is not a pure render-duration benchmark |
| Render a 1,000-line JSON sample | The 15-second evaluation deadline expired; the application later recovered | Rendering can block for a long time without demonstrating an infinite loop |
| Disable wrapping for the full highlighted JSON block in the diagnostic window | The 15-second evaluation deadline still expired | Disabling wrapping alone was not demonstrated to solve the issue |

These timings are diagnostic observations on the current machine, not universal performance thresholds.

## Identified Bottleneck

CPU profiling of the 500-line sample concentrated samples in native `measureSection()` in Obsidian's `app.js` (approximately line 441). The method reads `offsetTop` and `offsetHeight` to calculate section height. These geometry reads can force synchronous browser layout after content insertion.

The observed rendering chain is:

1. A large JSON block is tokenized for syntax highlighting.
2. Highlighting creates approximately 246,000 inline elements for the complete block.
3. Native preview inserts and measures the code section.
4. Synchronous layout of the large subtree occupies the UI thread, delaying input, painting, timers, and diagnostic responses.

Native preview manages document sections, but this large code block remains one section. Section-level virtualization therefore does not eliminate layout work inside that block.

The evidence identifies CPU-intensive synchronous layout as the primary observed bottleneck. It does not establish memory exhaustion, a JavaScript infinite loop, or a hardware-independent complexity bound. The former 1 MB limit was a protective policy, not a measured failure threshold.

Other documents can render normally because total file size does not determine rendering cost. Block size, syntax structure, generated node count, and distribution across sections also matter. This document concentrates almost all its content in one heavily highlighted section.

## Implications for Optimization

- Replacing the highlighter alone is unlikely to remove the dominant layout cost unless it also substantially reduces rendered nodes.
- Moving tokenization to a worker may improve responsiveness during tokenization, but DOM creation and layout still run on the UI thread.
- Making a function asynchronous does not automatically move its rendering work off the UI thread.
- Existing custom highlighting size limits do not prevent the native work when native highlighting executes before custom postprocessors.
- Effective interception must occur before the expensive native highlighting and layout. Replacing the code block only after native rendering may be too late.
- Any adaptive policy should target individual expensive code blocks rather than disable preview for the entire document based on file size alone.

## Options for Discussion

| Option | Expected benefit | Tradeoffs and verification needed |
| --- | --- | --- |
| Virtualize lines inside large code blocks | Keep rendered content bounded to visible lines and a buffer while preserving highlighting | Requires validation of selection, copy, search, scrolling, wrapping, sizing, and lifecycle behavior |
| Show a limited initial excerpt with an explicit viewer or expansion action | Reduce initial rendering work | Changes interaction; fully expanding through the original renderer can recreate the problem |
| Render expensive blocks as plain-text code blocks | Avoid the large syntax-highlighted subtree; supported by the language-change comparison | Removes highlighting for affected blocks; production interception remains to be designed and validated |
| Tokenize in a worker | Reduce foreground tokenization work | Complementary optimization only; does not resolve the demonstrated layout bottleneck by itself |

The preferred direction for evaluation is to preserve ordinary code blocks and use an internally virtualized viewer for expensive blocks. Reusing the project's existing CodeMirror 6 capabilities may reduce implementation work compared with building text selection and viewport rendering from scratch. This is a proposal, not a verified solution: long lines, wrapping, editor configuration, integration points, and preview sizing still require investigation.

## Completed Changes and Remaining Decision

- Removed the 1 MB protection from `plugins/content/src/editor/reading-mode.js`.
- Passed JavaScript syntax validation, TypeScript checking, and module-boundary checking.
- Built, installed, and reloaded only the Content plugin; verified installed package bytes and enabled state.
- Stopped the isolated diagnostic application. The regular Obsidian instance remained responsive.
- Did not modify the original note or implement any proposed performance optimization.

The user will select the optimization approach before implementation. Opening the affected note in highlighted reading mode can still reproduce the performance problem now that the protection has been removed.
