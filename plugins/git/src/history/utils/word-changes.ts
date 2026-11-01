interface Change { value: string; added?: boolean; removed?: boolean; }

/** Bounded token LCS; skip expensive highlights while retaining the complete diff. */
export function diffWordsWithSpace(before: string, after: string, options: { timeout: number }): Change[] | undefined {
    const tokenize = (text: string) => text.match(/[\p{L}\p{N}_]+|\s+|[^\p{L}\p{N}_\s]/gu) ?? [];
    const left = tokenize(before), right = tokenize(after);
    if (left.length * right.length > 250000) return undefined;
    const deadline = Date.now() + options.timeout;
    const width = right.length + 1;
    const matrix = new Uint32Array((left.length + 1) * width);
    for (let i = left.length - 1; i >= 0; i--) {
        if (Date.now() > deadline) return undefined;
        for (let j = right.length - 1; j >= 0; j--) matrix[i * width + j] = left[i] === right[j]
            ? matrix[(i + 1) * width + j + 1] + 1
            : Math.max(matrix[(i + 1) * width + j], matrix[i * width + j + 1]);
    }
    const changes: Change[] = [];
    let i = 0, j = 0;
    while (i < left.length || j < right.length) {
        if (i < left.length && j < right.length && left[i] === right[j]) { changes.push({ value: left[i++] }); j++; continue; }
        if (i < left.length && (j === right.length || matrix[(i + 1) * width + j] >= matrix[i * width + j + 1])) changes.push({ value: left[i++], removed: true });
        else changes.push({ value: right[j++], added: true });
    }
    return changes;
}
