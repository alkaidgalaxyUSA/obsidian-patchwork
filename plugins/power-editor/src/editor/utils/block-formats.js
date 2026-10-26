const HEADINGS = Array.from({ length: 6 }, (_, index) => ({
    id: `heading-${index + 1}`, label: `Heading ${index + 1}`, icon: `heading-${index + 1}`,
}));
const BASIC_BLOCKS = [
    { id: "text", label: "Text", icon: "type" },
    { id: "numbered-list", label: "Numbered list", icon: "list-ordered" },
    { id: "bulleted-list", label: "Bulleted list", icon: "list" },
    { id: "todo-list", label: "To-do list", icon: "list-todo" },
    { id: "code", label: "Code block", icon: "square-code" },
];
const RICH_BLOCKS = [
    { id: "highlighter", label: "Highlighter", icon: "highlighter" },
    { id: "quote", label: "Quote", icon: "quote" },
    { id: "columns", label: "Columns", icon: "columns-2" },
    { id: "collapse", label: "Collapse", icon: "chevrons-down-up" },
];
const INSERT_GROUPS = [
    { label: "Basic", items: [
        { id: "text", label: "Text", icon: "type" },
        { id: "table", label: "Table", icon: "table-2" },
        ...BASIC_BLOCKS.filter(({ id }) => id.endsWith("-list")),
    ] },
    { label: "Headings", items: HEADINGS },
    { label: "Programmer's area", items: [
        { id: "code", label: "Code block", icon: "square-code" },
        { id: "formula", label: "Formula", icon: "sigma" },
        { id: "text-diagram", label: "Text diagram", icon: "workflow" },
    ] },
    { label: "Layout and Style", items: [
        ...RICH_BLOCKS,
        { id: "divider", label: "Divider", icon: "minus" },
    ] },
];

function quote(text) { return text.split("\n").map((line) => line ? `> ${line}` : ">").join("\n"); }

function fenced(text, language = "") {
    const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((match) => match[0].length));
    const fence = "`".repeat(longest + 1);
    return `${fence}${language}\n${text}\n${fence}`;
}

const FORMATS = new Map([
    ...HEADINGS.map(({ id }, index) => [id, (text) => text.split("\n").map((line) => `${"#".repeat(index + 1)} ${line}`).join("\n")]),
    ["text", (text) => text],
    ["numbered-list", (text) => text.split("\n").map((line, index) => `${index + 1}. ${line}`).join("\n")],
    ["bulleted-list", (text) => text.split("\n").map((line) => `- ${line}`).join("\n")],
    ["todo-list", (text) => text.split("\n").map((line) => `- [ ] ${line}`).join("\n")],
    ["code", (text, options) => fenced(text, options?.language)],
    ["highlighter", (text, options) => `> [!note] ${options?.name || "Note"}\n${quote(text)}`],
    ["quote", quote],
    ["columns", (text, options) => columns(text, options?.layout)],
    ["collapse", (text, options) => `> [!note]- ${options?.name || "Details"}\n${quote(text)}`],
    ["divider", () => "---"],
    ["table", (_text, options) => table(options?.cols, options?.rows)],
    ["formula", (text) => `$$\n${text}\n$$`],
    ["text-diagram", () => fenced("flowchart LR\n    A --> B", "mermaid")],
]);

function columns(text, layout = "two") {
    const bodies = {
        two: "Left column\n---\nRight column",
        three: "First column\n---\nSecond column\n---\nThird column",
        "sidebar-left": "Sidebar\n--- 2\nMain content",
        "sidebar-right": "Main content\n--- 0.5\nSidebar",
    };
    return fenced(text ? `${text}\n---\n` : bodies[layout] ?? bodies.two, "columns");
}

function table(cols = 2, rows = 2) {
    const c = Math.max(1, cols);
    const row = "|" + "     |".repeat(c);
    const separator = "|" + " --- |".repeat(c);
    return [row, separator, ...Array.from({ length: Math.max(0, rows - 1) }, () => row)].join("\n");
}

function stripLinePrefixes(line) {
    let text = line;
    for (let i = 0; i < 6; i++) {
        const before = text;
        text = text.replace(/^\s*>\s?/, "")
            .replace(/^\s*\[!\w+\][+-]?\s*/, "")
            .replace(/^\s*(?:[-*+]|\d+[.)])\s+\[.\]\s+/, "")
            .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "")
            .replace(/^#{1,6}\s+/, "");
        if (text === before) break;
    }
    return text;
}

function formatBlock(type, text, options) {
    const format = FORMATS.get(type);
    if (!format) throw new Error("This block type is not supported.");
    if (options?.preserveBlank && type !== "text" && type !== "quote") {
        let ordinal = 0;
        return text.split("\n").map(line => {
            if (!line.trim()) return line;
            if (type === "numbered-list") return `${++ordinal}. ${line.trim()}`;
            return format(line.trim(), options);
        }).join("\n");
    }
    return format(text, options);
}

export { HEADINGS, BASIC_BLOCKS, RICH_BLOCKS, INSERT_GROUPS, formatBlock, stripLinePrefixes };
