import { decodeLiteralToken, isEscapedAt, isLiteralPunctuation, literalTextPattern } from "./literal-text";

export type InlineFormat = "bold" | "italic" | "underline" | "strike";
export interface FormatToken { from: number; to: number; name: string }
interface FormatSpan { from: number; start: number; end: number; to: number; kinds: InlineFormat[] }
interface TextUnit { from: number; to: number; raw: string; marks: Set<InlineFormat>; opaque?: boolean; html?: boolean }

const order: InlineFormat[] = ["bold", "italic", "underline", "strike"];
const tags: Record<InlineFormat, string> = { bold: "strong", italic: "em", underline: "u", strike: "s" };
const aliases: Record<string, InlineFormat> = { strong: "bold", b: "bold", em: "italic", i: "italic", u: "underline", s: "strike", del: "strike" };

/** Only parser-confirmed Markdown markers count; escaped user punctuation never does. */
function markdownSpans(text: string, tokens: FormatToken[]): FormatSpan[] {
    const spans: FormatSpan[] = [];
    const pending = new Map<string, { token: FormatToken; kinds: InlineFormat[] }>();
    for (const token of tokens) {
        if (!/formatting-(?:strong|em|strikethrough)/.test(token.name)) continue;
        const marker = text.slice(token.from, token.to);
        if (!/^(?:\*{1,3}|_{1,3}|~~)$/.test(marker) || isEscapedAt(text, token.from)) continue;
        const kinds: InlineFormat[] = marker === "~~" ? ["strike"] :
            marker.length === 3 ? ["bold", "italic"] : marker.length === 2 ? ["bold"] : ["italic"];
        const opening = pending.get(marker);
        if (!opening) { pending.set(marker, { token, kinds }); continue; }
        spans.push({ from: opening.token.from, start: opening.token.to, end: token.from, to: token.to, kinds });
        pending.delete(marker);
    }
    return spans;
}

/** One representation for the four toolbar styles, with literal source bytes intact.
 * Rebuilding only the affected lines lets partial/mixed selections split wrappers
 * without crossing tags or accumulating duplicate wrappers on repeated clicks. */
export function toggleInlineText(text: string, anchor: number, head: number, kind: InlineFormat, tokens: FormatToken[] = []): { text: string; anchor: number; head: number } {
    let from = Math.min(anchor, head), to = Math.max(anchor, head);
    const spans = markdownSpans(text, tokens);
    const units: TextUnit[] = [];
    const counts: Record<InlineFormat, number> = { bold: 0, italic: 0, underline: 0, strike: 0 };
    const protectedRanges = tokens.filter(token => /code|math|frontmatter/i.test(token.name));
    const literal = new RegExp(`^(?:${literalTextPattern.source})`);
    let htmlDepth = 0;
    for (let at = 0; at < text.length;) {
        const protectedRange = protectedRanges.find(token => token.from <= at && at < token.to);
        if (protectedRange) {
            units.push({ from: at, to: protectedRange.to, raw: text.slice(at, protectedRange.to), marks: new Set(), opaque: true });
            at = protectedRange.to;
            continue;
        }
        const marker = spans.find(span => span.from === at || span.end === at);
        if (marker) { at = marker.from === at ? marker.start : marker.to; continue; }
        const tag = text[at] === "<" && !isEscapedAt(text, at) ? /^<(\/?)([a-z]+)(?:\s[^>]*)?>/i.exec(text.slice(at)) : null;
        const format = tag && /^<\/?[a-z]+>$/i.test(tag[0]) && aliases[tag[2].toLowerCase()];
        if (format) {
            counts[format] = Math.max(0, counts[format] + (tag![1] ? -1 : 1));
            at += tag![0].length;
            continue;
        }
        const entity = literal.exec(text.slice(at));
        const length = tag ? tag[0].length : entity ? entity[0].length :
            text[at] === "\\" && isLiteralPunctuation(text[at + 1] ?? "") ? 2 : String.fromCodePoint(text.codePointAt(at)!).length;
        const marks = new Set(order.filter(mark => counts[mark] > 0 || spans.some(span => span.start <= at && at < span.end && span.kinds.includes(mark))));
        units.push({ from: at, to: at + length, raw: text.slice(at, at + length), marks, opaque: !!tag || text[at] === "\n", html: htmlDepth > 0 });
        if (tag && !/^<(?:br|img|hr|input|wbr)\b/i.test(tag[0])) htmlDepth = Math.max(0, htmlDepth + (tag[1] ? -1 : 1));
        at += length;
    }
    // Empty wrappers are a pending typing style, not another layer to append.
    if (from === to) {
        const open = `<${tags[kind]}>`, close = `</${tags[kind]}>`;
        if (text.slice(from - open.length, from) === open && text.slice(from, from + close.length) === close) {
            return { text: text.slice(0, from - open.length) + text.slice(from + close.length), anchor: from - open.length, head: from - open.length };
        }
        const word = units.filter(unit => !unit.opaque && /[\p{L}\p{N}_]/u.test(unit.raw));
        let first = word.findIndex(unit => unit.from <= from && unit.to >= from);
        if (first >= 0) {
            let last = first;
            while (first > 0 && word[first - 1].to === word[first].from) first--;
            while (last + 1 < word.length && word[last].to === word[last + 1].from) last++;
            from = word[first].from; to = word[last].to;
        } else {
            return { text: text.slice(0, from) + open + close + text.slice(from), anchor: from + open.length, head: from + open.length };
        }
    }
    const selected = units.filter(unit => !unit.opaque && unit.from < to && unit.to > from);
    if (!selected.length) return { text, anchor, head };
    const remove = selected.every(unit => unit.marks.has(kind));
    for (const unit of selected) {
        if (remove) unit.marks.delete(kind); else unit.marks.add(kind);
    }
    let output = "", active: InlineFormat[] = [], start = -1, end = -1;
    const transition = (next: InlineFormat[]) => {
        let common = 0;
        while (common < active.length && active[common] === next[common]) common++;
        for (let i = active.length - 1; i >= common; i--) output += `</${tags[active[i]]}>`;
        for (let i = common; i < next.length; i++) output += `<${tags[next[i]]}>`;
        active = next;
    };
    for (const unit of units) {
        transition(unit.opaque ? [] : order.filter(mark => unit.marks.has(mark)));
        const isSelected = !unit.opaque && unit.from < to && unit.to > from;
        if (isSelected && start < 0) start = output.length;
        const escaped = !unit.opaque && literal.exec(unit.raw);
        if (escaped && escaped[0] === unit.raw) {
            const char = decodeLiteralToken(unit.raw);
            output += unit.marks.size || unit.html || /[ \t]/.test(char) ? `&#${char.charCodeAt(0)};` : `\\${char}`;
        } else output += unit.raw;
        if (isSelected) end = output.length;
    }
    transition([]);
    return { text: output, anchor: anchor <= head ? start : end, head: anchor <= head ? end : start };
}
