import highlight from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import css from "highlight.js/lib/languages/css";
import xml from "highlight.js/lib/languages/xml";

let initialized = false;
const languages = { javascript, typescript, json, markdown, css, xml };
const extensions = { js: "javascript", jsx: "javascript", ts: "typescript", tsx: "typescript", json: "json", md: "markdown", css: "css", html: "xml", xml: "xml", svg: "xml" };

export function highlightLine(host, content, path) {
    const language = extensions[path?.split(".").pop()?.toLowerCase()];
    if (!language || content.length > 2000) { host.setText(content); return; }
    if (!initialized) { for (const [name, definition] of Object.entries(languages)) highlight.registerLanguage(name, definition); initialized = true; }
    // Highlight.js escapes source text; only its generated span markup is inserted.
    host.innerHTML = highlight.highlight(content, { language, ignoreIllegals: true }).value;
}

/** Overlay word ranges on syntax text nodes, preserving both kinds of highlighting. */
export function highlightSegments(host, content, path, segments) {
    highlightLine(host, content, path);
    if (!segments) return;
    let offset = 0;
    const ranges = segments.flatMap(segment => {
        const start = offset; offset += segment.value.length;
        return segment.changed ? [{ start, end: offset, type: segment.type || "modify" }] : [];
    });
    const walker = host.ownerDocument.createTreeWalker(host, 4);
    const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
    offset = 0;
    for (const node of nodes) {
        const text = node.textContent, start = offset; offset += text.length;
        const overlaps = ranges.filter(range => range.end > start && range.start < offset);
        if (!overlaps.length) continue;
        const fragment = host.ownerDocument.createDocumentFragment(); let position = 0;
        for (const range of overlaps) {
            const from = Math.max(0, range.start - start), to = Math.min(text.length, range.end - start);
            fragment.append(text.slice(position, from));
            const mark = host.ownerDocument.createElement("span"); mark.className = `pw-diff-word pw-diff-word-${range.type}`; mark.textContent = text.slice(from, to); fragment.append(mark); position = to;
        }
        fragment.append(text.slice(position)); node.replaceWith(fragment);
    }
}
