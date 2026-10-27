const LANGUAGES = [
    ["", "Plain text"], ["markdown", "Markdown"], ["vue", "Vue"], ["java", "Java"],
    ["shell", "Shell"], ["bash", "Bash"], ["javascript", "JavaScript"], ["typescript", "TypeScript"],
    ["jsx", "JSX"], ["tsx", "TSX"], ["python", "Python"], ["json", "JSON"], ["yaml", "YAML"],
    ["html", "HTML"], ["css", "CSS"], ["scss", "SCSS"], ["sql", "SQL"], ["xml", "XML"],
    ["go", "Go"], ["rust", "Rust"], ["c", "C"], ["cpp", "C++"], ["csharp", "C#"],
    ["kotlin", "Kotlin"], ["swift", "Swift"], ["php", "PHP"], ["ruby", "Ruby"],
    ["powershell", "PowerShell"], ["dockerfile", "Dockerfile"], ["diff", "Diff"],
];
const THEMES = [
    ["one-dark-pro", "One Dark Pro"], ["night-owl", "Night Owl"], ["darcula", "Darcula"],
    ["light", "Light"], ["graphite", "Graphite"], ["warm", "Warm"],
];
const FONT_SIZES = [12, 13, 14, 15, 16, 18, 20, 24];
const KEYS = { name: "title", theme: "pw-theme", font: "pw-font", indent: "pw-indent", unit: "pw-unit", wrap: "pw-wrap", lineNumbers: "pw-lines", autoIndent: "pw-auto-indent", height: "pw-height", width: "pw-width", offset: "pw-offset" };

function readOptions(info) {
    const attributes = {};
    for (const match of info.matchAll(/(?:^|\s)([\w-]+)=("(?:\\.|[^"\\])*"|'[^']*'|[^\s]+)/g)) {
        let value = match[2];
        try { value = value.startsWith('"') ? JSON.parse(value) : value.replace(/^'|'$/g, ""); } catch { continue; }
        attributes[match[1]] = value;
    }
    const candidate = info.trim().match(/^([^\s=]+)(?:\s|$)/)?.[1] ?? "";
    return {
        language: candidate,
        name: attributes.title ?? "",
        theme: THEMES.some(([key]) => key === attributes[KEYS.theme]) ? attributes[KEYS.theme] : "night-owl",
        font: FONT_SIZES.includes(Number(attributes[KEYS.font])) ? Number(attributes[KEYS.font]) : 14,
        indent: attributes[KEYS.indent] === "tabs" ? "tabs" : "spaces",
        unit: [2, 4, 8].includes(Number(attributes[KEYS.unit])) ? Number(attributes[KEYS.unit]) : 4,
        wrap: attributes[KEYS.wrap] !== "off",
        lineNumbers: attributes[KEYS.lineNumbers] === "on",
        autoIndent: attributes[KEYS.autoIndent] !== "off",
        height: Math.max(0, Math.min(2000, Number(attributes[KEYS.height]) || 0)),
        width: attributes[KEYS.width] === "wide" ? "wide" : "normal",
        offset: Math.max(0, Math.min(6, Math.floor(Number(attributes[KEYS.offset]) || 0))),
    };
}

function scanCodeBlocks(doc) {
    const blocks = [];
    let current;
    let frontmatter = doc.line(1).text === "---";
    for (let number = 1; number <= doc.lines; number++) {
        const line = doc.line(number);
        if (frontmatter) {
            if (number > 1 && /^(---|\.\.\.)\s*$/.test(line.text)) frontmatter = false;
            continue;
        }
        if (current) {
            const close = line.text.match(/^ {0,3}(`{3,}|~{3,})\s*$/);
            if (close && close[1][0] === current.fence[0] && close[1].length >= current.fence.length) {
                blocks.push({ ...current, closeFrom: line.from, to: line.to, endLine: number, contentTo: Math.max(current.contentFrom, line.from - 1) });
                current = undefined;
            }
            continue;
        }
        const open = line.text.match(/^( {0,3})(`{3,}|~{3,})(.*)$/);
        if (!open || (open[2][0] === "`" && open[3].includes("`"))) continue;
        current = {
            from: line.from, openTo: line.to, contentFrom: Math.min(line.to + 1, doc.length),
            startLine: number, opening: line.text, fence: open[2], prefix: open[1], info: open[3],
            options: readOptions(open[3]),
        };
    }
    if (current) blocks.push({ ...current, to: doc.length, contentTo: doc.length, endLine: doc.lines });
    return blocks;
}

function updateOpening(block, key, value) {
    let info = block.info;
    if (key === "language") {
        if (!/^[\w+#.-]*$/.test(value)) return block.opening;
        const old = block.options.language;
        info = old ? info.replace(old, value) : `${value}${info ? ` ${info.trimStart()}` : ""}`;
    } else {
        const attribute = KEYS[key];
        if (!attribute) return block.opening;
        const pattern = new RegExp(`(?:^|\\s)${attribute}=("(?:\\\\.|[^"\\\\])*"|'[^']*'|[^\\s]+)`, "g");
        info = info.replace(pattern, "").trimEnd();
        const normalized = String(value).replace(/[\r\n`]/g, " ").slice(0, 200);
        if (normalized) info += ` ${attribute}=${JSON.stringify(normalized)}`;
    }
    return `${block.prefix}${block.fence}${info.trimStart()}`;
}

function codeAttributes(options) {
    return {
        "data-pw-code": "", "data-pw-theme": options.theme,
        "data-pw-language": /^(markdown|md|mkd)$/i.test(options.language) ? "markdown" : options.language,
        "data-pw-wrap": options.wrap ? "on" : "off",
        "data-pw-width": options.width,
        "data-pw-lines": options.lineNumbers ? "on" : "off",
        "data-pw-offset": String(options.offset),
        style: `--pw-code-size:${options.font}px;--pw-code-offset:${options.offset * 24}px;tab-size:${options.unit};`,
    };
}

export { LANGUAGES, THEMES, FONT_SIZES, scanCodeBlocks, updateOpening, codeAttributes };
