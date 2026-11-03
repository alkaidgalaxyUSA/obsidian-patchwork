# JetBrains Platform Icons

Copyright (C) JetBrains s.r.o. and contributors.

Source: JetBrains/intellij-community, revision 4cc45ea6284376df26b1d290ea82fd55aae33cf7.

The collection contains 1377 selected SVG assets from platform/icons/src. Each normalized icon name has one preferred source. New UI assets are preferred, followed by the default 16px source where available. Redundant Classic, directory and size variants are removed. Distinct state names remain separate when their artwork differs. Files with identical upstream blob hashes share one retained asset; alternate source paths are recorded as aliases and remain searchable. Dark variants are used where available; icons without a theme counterpart remain shared assets.

Original retained SVG bytes, geometry, colors and embedded copyright comments are preserved. See LICENSE-JetBrains.txt for Apache License 2.0 and NOTICE-JetBrains.txt for the upstream notice. Third-party attribution embedded in individual SVGs remains applicable. Product and third-party logos remain subject to their respective trademark rights.

jetbrains-sources.json maps each retained asset to its local filename, original source path and Git blob SHA-1. Existing runtime action filenames are preserved where possible. Matching Patchwork action assets are replaced by the preferred IDEA source. Modifier overlays and code-type symbols remain separate from full-size action icons even when their names overlap. Git's duplicate tool-window asset is removed and its caller uses the existing branch asset.

[preview.html](../scripts/preview.html) displays all 1528 icons on one page in nine broad capability groups, using a continuous grid. Search, group filtering and independent preview scaling are available. Every sample uses a dark background.

## Size and Stroke

Source dimensions describe the original artwork. The existing runtime adapter fits the source viewBox into Obsidian's fixed registry canvas; component CSS controls rendered width and height. Additional source files for display sizes are unnecessary.

CSS stroke-width controls strokes. Many IDEA assets instead draw their apparent lines as filled paths, so CSS stroke-width cannot uniformly change their visual weight. Adding an outline changes the original artwork and is not applied. The preview uses external SVG images, whose internal paths are not styled by the page's CSS. Uniform adjustable weight requires icons designed with compatible strokes or explicit source editing.

New library assets are not automatically registered with plugin runtimes. Follow the existing module icon registration conventions when adopting an asset.
