# Diff Regression Checks

The suite exercises the production Patchwork Git diff renderer and algorithms. It does not install dependencies or change user repository contents.

## Automated checks

Run from the repository root:

```powershell
node tests/git-diff/run.mjs
node tests/git-diff/run.mjs --browser
```

The first command runs nine model/word/patch regression groups and four integration groups against a disposable Git repository. Integration checks stage, unstage and revert real patches, verify stale-patch rejection, and cover untracked additions and full-file deletions. The temporary repository is removed after the checks.

The second command also serves the browser fixture at `http://127.0.0.1:19431`. Open it and press **Run regression**, or evaluate `window.runRegression()` with the browser automation tool. `window.regressionResults` contains the results. Stop the server after testing.

The browser harness uses the production renderer, styles and navigation with small Obsidian DOM/icon adapters. Its 23 groups cover real line numbers, semantic colors, SVG connections, asymmetric wrapping, resizing, both scroll directions, independent scrolling, both diff modes, additions/deletions, empty/binary/rename cases, pagination, folding, both context-menu entry points, keyboard menus, multiple files/hunks, navigation, light/modal styles, large files and observer cleanup.

## Installed Obsidian checks

Run these only against the intended open vault after deploying Git. Enable developer debugging to capture console errors. Use a short CLI expression to read the script; passing the entire script as an argument can trigger an Obsidian CLI transport error on Windows.

```powershell
& $cli 'vault=my-notes' dev:debug on
& $cli 'vault=my-notes' eval 'code=eval(require("node:fs").readFileSync("D:/ideaProjects/obsidian-patchwork/tests/git-diff/live-preview.js","utf8"))'
& $cli 'vault=my-notes' eval 'code=eval(require("node:fs").readFileSync("D:/ideaProjects/obsidian-patchwork/tests/git-diff/live-regression.js","utf8"))'
& $cli 'vault=my-notes' dev:console level=error limit=10
```

Set `$cli` to the existing Obsidian CLI executable. Adjust the vault and script paths for the checkout. The preview is a synthetic patch held in memory; it does not write a note. The regression creates and closes its own temporary Diff tab and retains the synthetic modal for pointer checks. Keep the application visible so animation frames execute.

Validate actual mouse press/release sequences for settings, soft wraps, Split/Unified and repeated difference navigation. Also check keyboard navigation, and verify that unloading Git disconnects the preview and empties its renderer disposers. Do not restart or terminate Obsidian for this validation.

For dense scrolling checks, load `live-dense-preview.js` instead of `live-preview.js` to open 220 lines with 55 change blocks. Do not leave an earlier synthetic preview open.

For transient scrolling checks, expand the synthetic modal context and evaluate `live-scroll-regression.js` using the same short file-loading expression. It returns viewport coordinates and samples both scroll offsets, gutters and connector geometry for up to 15 seconds. Send real `Input.dispatchMouseEvent` wheel events through `dev:cdp` on each viewport, then inspect `window.__pwDiffValidation.scrollSample`. Require nonzero `movingFrames` and `trustedWheels`, and an empty `errors` array. Start the sampler and send wheel events in the same shell invocation so the 15-second sampling period does not expire between calls. The sampler verifies that trusted wheel events are canceled before native single-surface compositor scrolling can run. The application must remain visible.

Close only the synthetic preview and detach debugging when finished:

```powershell
& $cli 'vault=my-notes' eval 'code=(()=>{window.__pwDiffValidation?.cancelScrollSample?.();window.__pwDiffValidation?.modal.close();delete window.__pwDiffValidation;return "Diff validation cleaned up";})()'
& $cli 'vault=my-notes' dev:debug off
```

## Validation on 2026-11-13

- Nine automated model/word/patch groups passed.
- Four disposable-repository Git integration groups passed.
- All 23 browser groups passed, including a 3,500-line pagination/folding case.
- All eleven installed Obsidian groups passed for modal and tab surfaces.
- Empty-side boundary checks cover two-pixel text/gutter lines, matching block colors, two-pixel end faces abutting the entire line thickness without strokes inside the trapezoid, full-width text/gutter spans, insertion/deletion positions, aligned and unaligned views, full-file additions/deletions, viewport clipping and disposal.
- Connector regression verifies a 20-to-40-pixel replacement taper, two-pixel insertion/deletion end faces and uncolored placeholder gutters.
- Dense wheel regression passed 36 alternating input events over both documents and gutters. Pixel/line/page units, Shift horizontal scrolling, RTL, independent mode, browser zoom and wheel-listener disposal passed.
- Installed dense-preview validation captured 16 trusted wheel events and 16 moving frames across both sides without geometry or cancellation errors. A follow-up screenshot pixel check confirmed all nine fully visible connector centers matched the modification block color after the wheel burst.
- Rapid alternating programmatic scroll passed 24 frame checks. Actual installed-app wheel sequences on each side produced eight moving frames per sequence with no mixed document offsets, stale gutters or stale connectors.
- Git-only deployment completed and installed main.js, styles.css, manifest.json and LICENSE matched the packaged SHA-256 hashes.
- Physical pointer press/release checks passed for settings, wrapping, mode switches and repeated difference navigation; no renderer console errors were captured.
- Git unload/reload disconnected the previous preview and left zero renderer cleanup handles on it.
- Type checking, JavaScript syntax checks and module-boundary checks passed.

The implementation keeps Patchwork's existing Git patch backend and bounded text comparison. It reproduces the requested presentation and interaction model, not IntelliJ's Java diff engine or every IDE editing/merge command. Extremely large or expensive word comparisons retain the complete displayed lines and fall back to block highlighting.
