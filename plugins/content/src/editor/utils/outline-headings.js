// Outline labels are plain text, never rendered links, embeds or executable HTML.
function outlineLabel(heading) {
    const literals = [];
    const preserve = (value) => `\u0000${literals.push(value) - 1}\u0000`;
    return heading
        .replace(/\\([\\`*_{}\[\]()#+.!|>~-])/g, (_match, value) => preserve(value))
        .replace(/(`+)(.*?)\1/g, (_match, _ticks, value) => preserve(value))
        .replace(/!?\[\[([^\]]+)\]\]/g, (_match, link) => link.split("|").pop())
        .replace(/!?\[([^\]]+)\]\((?:[^()\n]|\([^()\n]*\))*\)/g, "$1")
        .replace(/!?\[([^\]]+)\]\[[^\]]*\]/g, "$1")
        .replace(/(\*{1,3}|_{1,3}|~~|==)(\S(?:.*?\S)?)\1/g, "$2")
        .replace(/<\/?[a-z][a-z0-9-]*(?:\s[^>]*)?\s*\/?>/gi, "")
        .replace(/\u0000(\d+)\u0000/g, (_match, index) => literals[Number(index)])
        .trim();
}

export { outlineLabel };
