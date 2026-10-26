// Use the editor's bundled language modes instead of a second reading-view grammar.
function highlightCode(code, language, unit, previous) {
    const cm = code.ownerDocument.defaultView.CodeMirror ?? globalThis.CodeMirror;
    if (!cm?.StringStream || !cm.getMode) return previous;
    const text = code.textContent;
    if (previous?.text === text && previous.language === language && previous.unit === unit
        && !code.querySelector(".token")) return previous;
    const info = cm.findModeByName(language) ?? cm.findModeByExtension(language);
    const spec = info?.mime ?? (cm.modes[language] ? language : "text/plain");
    const mode = cm.getMode({ tabSize: unit, indentUnit: unit }, spec);
    const state = cm.startState(mode);
    const fragment = code.ownerDocument.createDocumentFragment();
    const lines = text.split("\n");
    for (let index = 0; index < lines.length; index++) {
        if (index) fragment.append(code.ownerDocument.createTextNode("\n"));
        const stream = new cm.StringStream(lines[index], unit);
        if (!lines[index]) mode.blankLine?.(state);
        let stalled = 0;
        while (!stream.eol()) {
            stream.start = stream.pos;
            const style = mode.token(stream, state);
            if (stream.pos === stream.start) {
                if (++stalled > 10) return previous;
                continue;
            }
            stalled = 0;
            const token = stream.current();
            if (!style) { fragment.append(code.ownerDocument.createTextNode(token)); continue; }
            const span = code.ownerDocument.createElement("span");
            span.className = style.split(/\s+/).map((name) => `cm-${name}`).join(" ");
            span.textContent = token;
            fragment.append(span);
        }
    }
    if (fragment.textContent !== text) return previous;
    code.replaceChildren(fragment);
    return { text, language, unit };
}

export { highlightCode };
