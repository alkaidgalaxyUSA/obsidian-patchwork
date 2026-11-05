/** Pure text replacement ranges shared by independent editor adapters. */
export function changedLines(before, after) {
    if (before === after) return [];
    const tokenize = text => text.match(/[^\n]*\n|[^\n]+$/g) || [];
    const old = tokenize(before), current = tokenize(after);
    const offsets = [0];
    for (const line of current) offsets.push(offsets.at(-1) + line.length);
    const changes = [];
    const visit = (a, b, x, y, depth) => {
        while (a < b && x < y && old[a] === current[x]) { a++; x++; }
        while (a < b && x < y && old[b - 1] === current[y - 1]) { b--; y--; }
        if (a === b && x === y) return;
        if (depth < 32 && a < b && x < y) {
            const positions = new Map();
            for (let i = a; i < b; i++) positions.set(old[i], positions.has(old[i]) ? -1 : i);
            // Splitting around a unique shared line produces safe, disjoint ranges.
            for (let j = x; j < y; j++) {
                const i = positions.get(current[j]);
                if (i === undefined || i < 0) continue;
                visit(a, i, x, j, depth + 1); visit(i + 1, b, j + 1, y, depth + 1); return;
            }
        }
        changes.push({ from: offsets[x], to: offsets[y], insert: old.slice(a, b).join(""), type: a === b ? "added" : x === y ? "deleted" : "modified" });
    };
    visit(0, old.length, 0, current.length, 0);
    return changes;
}
