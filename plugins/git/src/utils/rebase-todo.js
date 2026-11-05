import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { rebaseSteps } from "./rebase-plan";

const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const shellPath = value => quote(value.replaceAll("\\", "/"));

async function messageCommand(directory, index, message) {
    const path = join(directory, `${index}.message`);
    await writeFile(path, message, { flag: "wx" });
    return `exec git commit --amend --file ${shellPath(path)}`;
}

/** Keep native label/reset/merge instructions when preserving topology. */
export async function writeRebaseEditor(rows, directory, preserveMerges) {
    if (!preserveMerges) {
        const lines = [], steps = rebaseSteps(rows);
        for (const [index, row] of steps.entries()) {
            lines.push(`${row.action} ${row.hash}`);
            if (row.message !== undefined) lines.push(await messageCommand(directory, index, row.message));
        }
        const todo = join(directory, "todo");
        await writeFile(todo, lines.join("\n") + "\n", { flag: "wx" });
        return `cat ${shellPath(todo)} >`;
    }
    const lines = ["#!/bin/sh", "set -eu", `output=${shellPath(join(directory, "generated-todo"))}`,
        'while IFS= read -r line || test -n "$line"; do', 'case "$line" in'];
    for (const [index, row] of rows.entries()) {
        if (row.action === "pick") continue;
        if (!/^[a-f\d]{40,64}$/i.test(row.hash) || !["reword", "edit", "drop"].includes(row.action)
            || row.merge && row.action !== "reword") throw new Error("Unsupported action in a merge-preserving rebase.");
        const patterns = row.merge ? [`merge -C ${row.hash} `, `merge -c ${row.hash} `] : [`pick ${row.hash} `];
        lines.push(patterns.map(pattern => quote(pattern) + "*").join("|") + ")");
        lines.push(`seen_${index}=1`);
        if (row.action === "reword") {
            lines.push('printf \'%s\\n\' "$line"');
            lines.push(`printf '%s\\n' ${quote(await messageCommand(directory, index, row.message))}`);
        } else lines.push(`printf '%s\\n' ${quote(`${row.action} ${row.hash}`)}`);
        lines.push(";;");
    }
    lines.push('* ) printf \'%s\\n\' "$line" ;;', 'esac', 'done < "$1" > "$output"');
    for (const [index, row] of rows.entries()) if (row.action !== "pick") {
        lines.push(`if test "\${seen_${index}:-0}" != 1; then printf '%s\\n' 'The native rebase plan changed. Reload commits before retrying.' >&2; exit 1; fi`);
    }
    lines.push('cat "$output" > "$1"');
    const script = join(directory, "sequence-editor.sh");
    await writeFile(script, lines.join("\n") + "\n", { flag: "wx" });
    return `sh ${shellPath(script)}`;
}
