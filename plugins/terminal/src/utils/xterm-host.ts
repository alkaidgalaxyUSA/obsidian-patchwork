/** Vendor rules stay unchanged inside the terminal widget's own shadow tree. */
export function createXtermHost(host: HTMLElement, vendorCss: string): HTMLElement {
    const shadow = host.attachShadow({ mode: "open" });
    const style = host.ownerDocument.createElement("style");
    style.textContent = vendorCss;
    shadow.append(style);
    const layout = host.ownerDocument.createElement("style");
    layout.textContent = ":host { display: block; height: 100%; } .pw-xterm-root, .pw-xterm-root > .xterm { height: 100%; } .xterm-viewport { background-color: #1e1f22; }";
    shadow.append(layout);
    const root = host.ownerDocument.createElement("div");
    root.className = "pw-xterm-root";
    shadow.append(root);
    return root;
}
