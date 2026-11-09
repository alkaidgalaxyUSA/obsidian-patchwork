import { createIdeaMatcher, parseSearchLocation } from "./idea-matcher";

const textExtensions = new Set("md txt canvas sql js ts jsx tsx mjs cjs json jsonc jsonl yaml yml xml html htm css scss sass less py java kt kts c h cpp hpp cs go rs rb php sh bash zsh ps1 bat cmd ini conf config cfg properties toml csv tsv log graphql vue svelte gitignore env dockerfile makefile".split(" "));
export const searchCategories = [["all", "All"], ["files", "Files"], ["actions", "Actions"], ["text", "Text"]];
export const resultKey = result => result.kind === "action" ? `action:${result.command.id}` : result.kind === "more" ? "more" : `${result.kind}:${result.file.path}:${result.line ?? ""}:${result.column ?? ""}`;

/** IDEA contributor limits and recent/file deduplication, adapted to Obsidian's vault and command registry. */
export async function searchFiles(app, query, mode, signal, publish, options = {}) {
    const limit = options.limit ?? (mode === "all" ? 15 : 30);
    const files = app.vault.getFiles().filter(file => !options.extension || file.extension === options.extension);
    const recentPaths = app.workspace.getLastOpenFiles();
    const recency = new Map(recentPaths.map((path, i) => [path, i]));
    const location = parseSearchLocation(query.trim());
    const matcher = createIdeaMatcher(location.pattern.replace(/\\/g, "/"));
    const results = [], more = new Set();
    let skipped = 0, scanned = 0, lastYield = performance.now();
    const report = done => {
        signal.throwIfAborted();
        publish({ results: [...results, ...(more.size ? [{ kind: "more" }] : [])], skipped, scanned, done, limited: more.size > 0 });
    };
    const yieldIfNeeded = async () => {
        signal.throwIfAborted();
        if (performance.now() - lastYield < 16) return;
        report(false); await new Promise(resolve => setTimeout(resolve, 0)); lastYield = performance.now();
        signal.throwIfAborted();
    };
    const add = (items, provider) => {
        if (items.length > limit) more.add(provider);
        results.push(...items.slice(0, limit).map(item => ({ ...item, provider })));
    };
    if (!query.trim()) {
        if (mode === "actions" || mode === "text") { report(true); return; }
        const active = new Set();
        app.workspace.iterateAllLeaves?.(leaf => {
            if (leaf.parent?.children?.[leaf.parent.currentTab] === leaf && leaf.view.file) active.add(leaf.view.file.path);
        });
        const byPath = new Map(files.map(file => [file.path, file]));
        add([...new Set(recentPaths)].filter(path => !active.has(path) && byPath.has(path))
            .map(path => ({ file: byPath.get(path), kind: "file" })), "Recent files");
        report(true); return;
    }
    if (mode === "all" || mode === "files") {
        const matches = [];
        for (const file of files) {
            const nameMatch = matcher(file.name);
            const pathMatch = nameMatch ? undefined : matcher(file.path);
            const match = nameMatch ?? pathMatch;
            const nameOffset = file.path.length - file.name.length;
            if (match) matches.push({ file, kind: "file", ...location, score: match.score,
                nameRanges: nameMatch?.ranges ?? pathMatch?.ranges.filter(([, end]) => end > nameOffset).map(([start, end]) => [Math.max(0, start - nameOffset), end - nameOffset]),
                pathRanges: pathMatch?.ranges });
            await yieldIfNeeded();
        }
        matches.sort((a, b) => b.score - a.score || (recency.get(a.file.path) ?? Infinity) - (recency.get(b.file.path) ?? Infinity)
            || a.file.name.localeCompare(b.file.name) || a.file.path.localeCompare(b.file.path));
        if (mode === "all") {
            const recent = matches.filter(result => recency.has(result.file.path));
            add(recent, "Recent files");
            const shown = new Set(results.map(result => result.file.path));
            add(matches.filter(result => !shown.has(result.file.path)), "Files");
        } else add(matches, "Files");
        report(false);
    }
    if (mode === "all" || mode === "actions") {
        const commands = app.commands?.listCommands?.() ?? [];
        const actionMatcher = createIdeaMatcher(query.trim());
        const matches = [];
        for (const command of commands) {
            const match = actionMatcher(command.name);
            if (match) matches.push({ kind: "action", command, score: match.score, nameRanges: match.ranges });
            await yieldIfNeeded();
        }
        matches.sort((a, b) => b.score - a.score || a.command.name.localeCompare(b.command.name));
        add(matches, "Actions"); report(false);
    }
    if (mode !== "text" && mode !== "all") { report(true); return; }
    // Literal text matching follows the Text contributor rather than camel-hump name matching.
    const needle = options.matchCase ? query : query.toLowerCase();
    let count = 0;
    for (const file of files) {
        signal.throwIfAborted(); scanned++;
        if (!textExtensions.has(file.extension.toLowerCase()) && !textExtensions.has(file.name.toLowerCase()) || file.stat.size > 5 * 1024 * 1024) { skipped++; continue; }
        try {
            const text = await app.vault.cachedRead(file);
            signal.throwIfAborted();
            if (text.includes("\0")) { skipped++; continue; }
            const lines = text.split(/\r?\n/);
            for (let line = 0; line < lines.length; line++) {
                const comparable = options.matchCase ? lines[line] : lines[line].toLowerCase();
                let column = comparable.indexOf(needle);
                while (column >= 0) {
                    const before = comparable[column - 1] ?? "", after = comparable[column + needle.length] ?? "";
                    if (!options.wholeWord || !/[\p{L}\p{N}_]/u.test(before) && !/[\p{L}\p{N}_]/u.test(after)) {
                        if (++count > limit) { more.add("Text"); report(true); return; }
                        const start = Math.max(0, column - 40);
                        results.push({ file, kind: "text", provider: "Text", line, column: Array.from(lines[line].slice(0, column)).length,
                            preview: (start ? "…" : "") + lines[line].slice(start, start + 160),
                            previewRanges: [[column - start + Number(start > 0), column - start + Number(start > 0) + needle.length]] });
                    }
                    column = comparable.indexOf(needle, column + Math.max(1, needle.length));
                }
                if (line % 100 === 0) await yieldIfNeeded();
            }
        } catch (error) { if (signal.aborted) throw error; skipped++; }
        await yieldIfNeeded();
    }
    report(true);
}
