/** Keep actionable Git failures visible instead of filling a notice with line-ending warnings. */
export function gitErrorSummary(message) {
    const text = String(message);
    const details = text.split(/\r?\n/).filter(line => !/^(warning:|hint:)/i.test(line)).join("\n").trim() || text.trim();
    const lines = details.split(/\r?\n/);
    const summary = lines.slice(0, 6).join("\n");
    return summary.length > 600 ? `${summary.slice(0, 600)}…` : lines.length > 6 ? `${summary}\n…` : summary;
}
