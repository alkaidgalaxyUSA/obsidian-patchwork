// Translate the bundled Markdown mode's presentation tokens to code-card roles.
function isNightOwlMarkdown(language, theme) {
    return theme === "night-owl" && /^(markdown|md|mkd)$/i.test(language);
}

function markdownCodeTokens(style, value, from) {
    const names = new Set(style.split(/\s+/));
    const classes = [];
    if (names.has("header")) classes.push("cm-header");
    if (names.has("strong")) classes.push("cm-strong");
    if (names.has("em")) classes.push("cm-emphasis");
    if (names.has("link") || names.has("url") || names.has("image")) classes.push("cm-link");
    if (names.has("url")) classes.push("cm-url");
    if (names.has("hr")) classes.push("cm-atom");
    const token = (start, end, extra = []) => ({ from: from + start, to: from + end, className: [...classes, ...extra].join(" ") });
    if (names.has("formatting-code-block")) {
        const fence = value.match(/^(\s*)(`{3,}|~{3,})(.*)$/);
        if (fence) {
            const start = fence[1].length;
            const end = start + fence[2].length;
            const result = [token(start, end, ["cm-meta"])];
            if (end < value.length) result.push(token(end, value.length, ["cm-labelName"]));
            return result;
        }
    }
    if (names.has("formatting")) {
        // The legacy mode includes heading/list whitespace in the marker token.
        const end = value.trimEnd().length;
        const result = end ? [token(0, end, ["cm-meta"])] : [];
        if (end < value.length && classes.length) result.push(token(end, value.length));
        return result;
    }
    // List text and inline code are ordinary text, not variables or comments.
    return classes.length ? [token(0, value.length)] : [];
}

export { isNightOwlMarkdown, markdownCodeTokens };
