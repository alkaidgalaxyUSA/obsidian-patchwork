const MARKDOWN_LANGUAGES = new Set(["md", "markdown", "mdown", "mkd"]);

function readCodeBlock(wrapper) {
    const pre = wrapper.querySelector(":scope > pre");
    const code = pre?.querySelector("code");
    if (!code) return undefined;

    const languageClass = Array.from(code.classList).find((name) => name.startsWith("language-"));
    const candidate = languageClass?.slice("language-".length) ?? "";
    const language = /^[a-zA-Z0-9_+-]+$/.test(candidate) ? candidate : "";
    return { text: code.textContent ?? "", language };
}

function formatCodeBlock(block, mode) {
    const raw = mode === "raw" || (mode === "auto" && MARKDOWN_LANGUAGES.has(block.language.toLowerCase()));
    if (raw) return { text: block.text, fenced: false };

    const runs = block.text.match(/`+/g) ?? [];
    const length = runs.reduce((maximum, run) => Math.max(maximum, run.length + 1), 3);
    const fence = "`".repeat(length);
    const ending = block.text.endsWith("\n") ? "" : "\n";
    return { text: `${fence}${block.language}\n${block.text}${ending}${fence}`, fenced: true };
}

function separateBlock(text, before, after) {
    const prefix = !before || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
    const suffix = !after ? "\n" : after.startsWith("\n\n") ? "" : after.startsWith("\n") ? "\n" : "\n\n";
    return `${prefix}${text}${suffix}`;
}

module.exports = { readCodeBlock, formatCodeBlock, separateBlock };
