import { isNightOwlMarkdown, markdownCodeTokens } from "./markdown-code-tokens.js";

// Use the editor's bundled language modes instead of a second reading-view grammar.
function codeTokens(doc, text, language, unit, previous, theme = "night-owl") {
    const cm = doc.defaultView.CodeMirror ?? globalThis.CodeMirror;
    if (!cm?.StringStream || !cm.getMode) return undefined;
    const info = cm.findModeByName(language) ?? cm.findModeByExtension(language);
    const parser = cm.modes[info?.mode ?? language];
    if (previous?.text === text && previous.language === language && previous.unit === unit
        && previous.parser === parser && previous.theme === theme) return previous;
    const markdown = isNightOwlMarkdown(language, theme);
    const spec = markdown ? { name: "markdown", highlightFormatting: true }
        : info?.mime ?? (cm.modes[language] ? language : "text/plain");
    const mode = cm.getMode({ tabSize: unit, indentUnit: unit }, spec);
    const state = cm.startState(mode);
    const tokens = [];
    const lines = text.split("\n");
    let offset = 0;
    for (let index = 0; index < lines.length; index++) {
        const stream = new cm.StringStream(lines[index], unit);
        if (!lines[index]) mode.blankLine?.(state);
        let stalled = 0;
        while (!stream.eol()) {
            stream.start = stream.pos;
            const style = mode.token(stream, state);
            if (stream.pos === stream.start) {
                if (++stalled > 10) return undefined;
                continue;
            }
            stalled = 0;
            if (style && markdown && (cm.innerMode(mode, state).mode.name === "markdown" || style.includes("formatting-code-block"))) {
                tokens.push(...markdownCodeTokens(style, stream.current(), offset + stream.start));
                continue;
            }
            if (style) tokens.push({
                from: offset + stream.start, to: offset + stream.pos,
                className: style.split(/\s+/).map((name) => `cm-${name}`).join(" "),
            });
        }
        offset += lines[index].length + 1;
    }
    return { text, language, unit, parser, theme, tokens };
}

function highlightCode(code, language, unit, previous) {
    const text = code.textContent;
    const result = codeTokens(code.ownerDocument, text, language, unit, previous, code.closest("[data-pw-theme]")?.dataset.pwTheme ?? "night-owl");
    if (!result || result.text !== text || result === previous && !code.querySelector(".token")) return previous;
    const fragment = code.ownerDocument.createDocumentFragment();
    let offset = 0;
    for (const token of result.tokens) {
        fragment.append(code.ownerDocument.createTextNode(text.slice(offset, token.from)));
        const span = code.ownerDocument.createElement("span");
        span.className = token.className;
        span.textContent = text.slice(token.from, token.to);
        fragment.append(span);
        offset = token.to;
    }
    fragment.append(code.ownerDocument.createTextNode(text.slice(offset)));
    if (fragment.textContent !== text) return previous;
    code.replaceChildren(fragment);
    return result;
}

export { codeTokens, highlightCode };
