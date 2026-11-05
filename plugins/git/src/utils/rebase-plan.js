/** Resolve Git's fold chains without discarding full commit messages. */
export function rebaseGroups(rows) {
    const groups = [];
    for (const row of rows) {
        if (row.action === "drop") continue;
        if (["squash", "fixup"].includes(row.action)) {
            if (!groups.length) throw new Error("The first retained commit must be Pick, Reword or Stop to Edit.");
            groups.at(-1).rows.push(row);
        } else groups.push({ root: row, rows: [row] });
    }
    return groups.map(group => {
        const contributors = group.rows.filter((row, index) => index === 0 || row.action === "squash");
        const messages = contributors.map(row => row.message.trim());
        const signature = JSON.stringify(contributors.map(row => [row.hash, row.message]));
        const squash = group.rows.some(row => row.action === "squash");
        let message = messages.join("\n\n");
        const edit = group.root.squashEdit;
        if (edit?.signature === signature) message = edit.message;
        else if (edit) {
            const previous = JSON.parse(edit.signature);
            if (previous.length < contributors.length && JSON.stringify(contributors.slice(0, previous.length).map(row => [row.hash, row.message])) === edit.signature) {
                message = [edit.message, ...messages.slice(previous.length)].join("\n\n");
            }
        }
        return { ...group, signature, squash, message };
    });
}

export function rebasePlanError(rows, root = false) {
    try {
        const groups = rebaseGroups(rows);
        if (root && !groups.length) return "A root rebase must retain at least one commit.";
        if (groups.some(group => (group.squash || group.root.action === "reword") && !group.message.trim())) return "Enter a message for every Reword or Squash commit.";
        return "";
    } catch (error) { return error.message; }
}

/** Amend only after the final fixup so Git cannot overwrite the edited message. */
export function rebaseSteps(rows) {
    const groups = rebaseGroups(rows);
    const messages = new Map(groups.filter(group => group.squash || group.root.action === "reword")
        .map(group => [group.rows.at(-1).hash, group.message]));
    return rows.map(row => ({ hash: row.hash, action: row.action === "reword" ? "pick" : row.action === "squash" ? "fixup" : row.action, message: messages.get(row.hash) }));
}
