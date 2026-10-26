function wrapCodeLines(code) {
    if (code.querySelector(":scope > .pw-code-read-line")) return;
    const doc = code.ownerDocument;
    const lines = [doc.createElement("span")];
    const visit = (node, parents) => {
        if (node.nodeType === 1) {
            for (const child of node.childNodes) visit(child, [...parents, node]);
            return;
        }
        if (node.nodeType !== 3) return;
        const parts = node.textContent.split("\n");
        parts.forEach((part, index) => {
            if (index) lines.push(doc.createElement("span"));
            if (!part) return;
            let parent = lines[lines.length - 1];
            for (const original of parents) {
                const clone = original.cloneNode(false);
                parent.append(clone);
                parent = clone;
            }
            parent.append(doc.createTextNode(part));
        });
    };
    for (const child of code.childNodes) visit(child, []);
    const trailing = code.textContent.endsWith("\n");
    if (trailing) lines.pop();
    const fragment = doc.createDocumentFragment();
    lines.forEach((line, index) => {
        line.className = "pw-code-read-line";
        line.dataset.pwLineNumber = String(index + 1);
        fragment.append(line);
        if (index < lines.length - 1 || trailing) fragment.append(doc.createTextNode("\n"));
    });
    code.replaceChildren(fragment);
}

function unwrapCodeLines(code) {
    for (const line of code.querySelectorAll(":scope > .pw-code-read-line")) line.replaceWith(...line.childNodes);
}

export { wrapCodeLines, unwrapCodeLines };
