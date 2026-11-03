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
