/** Portable Markdown escapes keep typed punctuation literal in every renderer. */
export function escapeLiteralText(text: string, atLineStart = true, inHtml = false): string {
    const escaped = text.replace(/[!-/:-@\[-`{-~]/g, "\\$&");
    // A leading entity renders the original whitespace without creating an
    // indented Markdown code block. A typed '&' was already escaped above.
    const result = escaped.replace(/(^|\n)([ \t])/g, (match, prefix: string, space: string, offset: number) =>
        offset === 0 && !atLineStart ? match : prefix + (space === "\t" ? "&#9;" : "&#32;"));
    return inHtml ? result.replace(literalTextPattern, value => `&#${decodeLiteralToken(value).charCodeAt(0)};`) : result;
}

export function isInlineHtmlAt(text: string, at: number): boolean {
    const stack: string[] = [];
    const pattern = /<(\/?)(strong|em|u|s|b|i|del|span|mark|sub|sup)(?:\s[^>]*)?>/gi;
    for (let match; (match = pattern.exec(text)) && pattern.lastIndex <= at;) {
        if (isEscapedAt(text, match.index)) continue;
        const tag = match[2].toLowerCase();
        if (!match[1]) stack.push(tag);
        else { const index = stack.lastIndexOf(tag); if (index >= 0) stack.splice(index); }
    }
    return stack.length > 0;
}

export function isLiteralPunctuation(char: string): boolean {
    return /^[!-/:-@\[-`{-~]$/.test(char);
}

export function isEscapedAt(text: string, at: number): boolean {
    let slashes = 0;
    while (at > 0 && text[--at] === "\\") slashes++;
    return slashes % 2 === 1;
}

// Numeric entities are used inside HTML formatting, where Obsidian's unfocused
// HTML widget does not interpret Markdown backslash escapes.
export const literalTextPattern = /\\[!-/:-@\[-`{-~]|&#(?:9|3[2-9]|4[0-7]|5[89]|6[0-4]|9[1-6]|12[3-6]);/g;

export function decodeLiteralToken(value: string): string {
    return value[0] === "&" ? String.fromCharCode(Number(value.slice(2, -1))) : value.slice(1);
}

/** Protect escaped characters from formatting regexes, optionally decoding for copy. */
export function transformLiteralText(text: string, transform: (text: string) => string, decode = false): string {
    let prefix = "\uE000pw";
    while (text.includes(prefix)) prefix += "p";
    const values: string[] = [];
    const protectedText = text.replace(literalTextPattern, value => {
        values.push(decode ? decodeLiteralToken(value) : value);
        return `${prefix}${values.length - 1}\uE001`;
    });
    return transform(protectedText).replace(new RegExp(`${prefix}(\\d+)\uE001`, "g"), (_, index) => values[Number(index)]);
}
