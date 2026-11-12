/** Adjacent removed/added lines form one change, even inside a shared Git hunk. */
export function differenceCount(file) {
    let count = 0;
    for (const hunk of file?.hunks ?? []) {
        let changing = false;
        for (const line of hunk.lines) {
            const changed = line.type === "add" || line.type === "del";
            if (changed && !changing) count++;
            changing = changed;
        }
    }
    return count;
}
