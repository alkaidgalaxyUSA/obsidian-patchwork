/** Preserve Git's quoting and no-final-newline markers when selecting a hunk. */
export function hunkPatch(raw: string, fileIndex: number, hunkIndex: number): { patch: string; section: string } {
    const sections = raw.match(/^diff --git [\s\S]*?(?=^diff --git |$(?![\s\S]))/gm) ?? [];
    const section = sections[fileIndex];
    if (!section) throw new Error("The selected diff is no longer available.");
    const starts = [...section.matchAll(/^@@ .*$/gm)].map(match => match.index!);
    const start = starts[hunkIndex];
    if (start === undefined) throw new Error("The selected hunk is no longer available.");
    const header = section.slice(0, starts[0]);
    const body = section.slice(start, starts[hunkIndex + 1] ?? section.length);
    return { patch: header + body, section };
}
