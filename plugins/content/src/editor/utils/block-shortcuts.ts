import { escapeLiteralText, transformLiteralText } from "../../utils/literal-text";
import { splitTableRow } from "../../blocks";

/** Convert only complete block prefixes; all other typed punctuation stays literal. */
export function blockShortcut(raw: string, trigger: " " | "Enter"): { text: string; caret: number } | undefined {
    const decoded = transformLiteralText(raw, value => value, true);
    // Visually blank lines can contain escaped spaces. Markdown permits up to
    // three leading spaces before a block marker; four spaces remain literal.
    const prefix = decoded.replace(/^ {1,3}(?=\S)/, "");
    const text = trigger === "Enter" ? prefix.replace(/ +$/, "") : prefix;
    if (trigger === " ") {
        const marker = /^(#{1,6}|>|[-+*]|\d{1,9}\.)$/.exec(text)?.[1];
        if (marker) return { text: `${marker} `, caret: marker.length + 1 };
        const task = /^([-+*] +)?\[([ xX]?)\]$/.exec(text);
        if (task) {
            const prefix = `${task[1] ?? "- "}[${task[2].toLowerCase() === "x" ? "x" : " "}] `;
            return { text: prefix, caret: prefix.length };
        }
        return;
    }
    const fence = /^(`{3,})([\w+#.-]*)$/.exec(text);
    if (fence) {
        const opening = `${fence[1]}${fence[2]}`;
        return { text: `${opening}\n\n${fence[1]}\n`, caret: opening.length + 1 };
    }
    // A blank line before the rule avoids both YAML frontmatter and Setext headings.
    if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(text)) return { text: `\n${text}\n\n`, caret: text.length + 3 };
    if (!text.startsWith("|") || !text.endsWith("|")) return;
    const pieces = splitTableRow(text);
    if (!pieces || pieces[0] !== "" || pieces[pieces.length - 1] !== "") return;
    const cells = pieces.slice(1, -1).map(cell => escapeLiteralText(cell.trim(), false));
    const header = `| ${cells.join(" | ")} |`;
    const divider = `| ${cells.map(() => "---").join(" | ")} |`;
    const row = `| ${cells.map(() => " ").join(" | ")} |`;
    return { text: `\n${header}\n${divider}\n${row}\n\n`, caret: header.length + divider.length + 5 };
}
