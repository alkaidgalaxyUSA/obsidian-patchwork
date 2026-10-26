import type { CodeBlock, InsertMode } from "../types";

const MARKDOWN_LANGUAGES = new Set(["md", "markdown", "mdown", "mkd"]);

export function readCodeBlock(wrapper: HTMLElement): CodeBlock | undefined {
    const pre = wrapper.querySelector<HTMLElement>(":scope > pre");
    const code = pre?.querySelector<HTMLElement>("code");
    if (!code) return undefined;

    const languageClass = Array.from(code.classList).find((name) => name.startsWith("language-"));
    const candidate = languageClass?.slice("language-".length) ?? "";
    const language = /^[a-zA-Z0-9_+-]+$/.test(candidate) ? candidate : "";
    return { text: code.textContent ?? "", language };
}

export function formatCodeBlock(block: CodeBlock, mode: InsertMode) {
    const raw = mode === "raw" || (mode === "auto" && MARKDOWN_LANGUAGES.has(block.language.toLowerCase()));
    if (raw) return { text: block.text, fenced: false };

    const runs = block.text.match(/`+/g) ?? [];
    const length = runs.reduce((maximum, run) => Math.max(maximum, run.length + 1), 3);
    const fence = "`".repeat(length);
    const ending = block.text.endsWith("\n") ? "" : "\n";
    return { text: `${fence}${block.language}\n${block.text}${ending}${fence}`, fenced: true };
}

export function separateBlock(text: string, before: string, after: string) {
    const prefix = !before || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
    const suffix = !after ? "\n" : after.startsWith("\n\n") ? "" : after.startsWith("\n") ? "\n" : "\n\n";
    return `${prefix}${text}${suffix}`;
}

