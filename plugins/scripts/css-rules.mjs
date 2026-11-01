/** Small source-preserving CSS walker. Strings, comments and function arguments
 * are opaque; grouping at-rules recurse, while keyframes and declarations do not. */
export function splitSelectors(text) {
  const result = [];
  let start = 0, depth = 0, quote = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) { if (ch === "\\") i++; else if (ch === quote) quote = ""; continue; }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === "(" || ch === "[") depth++;
    if (ch === ")" || ch === "]") depth--;
    if (ch === "," && depth === 0) { result.push(text.slice(start, i).trim()); start = i + 1; }
  }
  result.push(text.slice(start).trim());
  return result.filter(Boolean);
}

export function mapCssRules(text, transform, parents = [], includeKeyframes = false) {
  let output = "", start = 0, quote = "", parens = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) { if (ch === "\\") i++; else if (ch === quote) quote = ""; continue; }
    if (ch === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      if (end < 0) throw new Error("Unclosed CSS comment");
      i = end + 1; continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === "(" || ch === "[") parens++;
    if (ch === ")" || ch === "]") parens--;
    if (parens) continue;
    if (ch === ";") { output += text.slice(start, i + 1); start = i + 1; continue; }
    if (ch !== "{") continue;
    const raw = text.slice(start, i);
    const match = raw.match(/^((?:\s|\/\*[\s\S]*?\*\/)*)([\s\S]*)$/);
    const [, leading, header] = match;
    let depth = 1, end = i + 1, innerQuote = "";
    for (; end < text.length; end++) {
      const current = text[end];
      if (innerQuote) { if (current === "\\") end++; else if (current === innerQuote) innerQuote = ""; continue; }
      if (current === "/" && text[end + 1] === "*") {
        const close = text.indexOf("*/", end + 2);
        if (close < 0) throw new Error("Unclosed CSS comment");
        end = close + 1; continue;
      }
      if (current === '"' || current === "'") { innerQuote = current; continue; }
      if (current === "{") depth++;
      if (current === "}" && --depth === 0) break;
    }
    if (depth !== 0) throw new Error(`Unclosed CSS rule: ${header}`);
    const body = text.slice(i + 1, end);
    const name = header.trim();
    let replacement;
    if (/^@(media|supports|layer|container|scope|document)\b/.test(name)
        || includeKeyframes && /^@(?:-webkit-)?keyframes\b/.test(name)) {
      replacement = `${header}{${mapCssRules(body, transform, [...parents, name], includeKeyframes)}}`;
    } else if (name.startsWith("@")) replacement = `${header}{${body}}`;
    else replacement = transform({ selector: header.trim(), body, parents }) ?? `${header}{${body}}`;
    output += leading + replacement;
    i = end; start = end + 1;
  }
  return output + text.slice(start);
}
