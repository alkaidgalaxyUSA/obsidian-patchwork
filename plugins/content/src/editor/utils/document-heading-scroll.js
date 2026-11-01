import { EditorView } from "@codemirror/view";

/** Align a heading below the visible document edge after native layout settles. */
export async function scrollDocumentHeading(view, heading, current) {
    const win = view.containerEl.ownerDocument.defaultView;
    const line = heading.position.start.line;
    view.leaf.setEphemeralState({ line });
    const preview = view.getMode?.() === "preview";
    const renderer = preview && view.previewMode?.renderer;
    const editor = !preview && view.editor?.cm;
    if (renderer?.applyScrollDelayed) {
        await new Promise(resolve => {
            const timer = win.setTimeout(resolve, 750);
            renderer.applyScrollDelayed(line, {}, () => { win.clearTimeout(timer); resolve(); });
        });
    } else if (editor) {
        view.editor.setCursor({ line, ch: 0 });
        const position = editor.state.doc.line(Math.min(line + 1, editor.state.doc.lines)).from;
        editor.dispatch({ effects: EditorView.scrollIntoView(position, { y: "start", yMargin: 10 }) });
    }
    // Reading-mode virtualization and editor measurements can finish on later frames.
    for (let attempt = 0; attempt < 5; attempt++) {
        await new Promise(resolve => win.requestAnimationFrame(resolve));
        if (!current() || (view.getMode?.() === "preview") !== preview) return;
        const scroller = preview ? renderer?.previewEl : editor?.scrollDOM;
        if (!scroller?.isConnected || !scroller.clientHeight) return;
        const visibleTop = Math.max(view.contentEl.getBoundingClientRect().top + view.contentEl.clientTop,
            scroller.getBoundingClientRect().top + scroller.clientTop);
        let headingTop;
        if (preview) {
            const section = renderer.sections.find(item => item.start?.line === line
                && item.el?.querySelector("h1, h2, h3, h4, h5, h6"));
            const element = section?.el.querySelector("h1, h2, h3, h4, h5, h6");
            if (!element?.getClientRects().length) continue;
            headingTop = element.getBoundingClientRect().top;
        } else {
            const position = editor.state.doc.line(Math.min(line + 1, editor.state.doc.lines)).from;
            headingTop = editor.documentTop + editor.lineBlockAt(position).top;
        }
        const difference = headingTop - visibleTop - 10;
        if (Math.abs(difference) > 0.5) scroller.scrollTo({ top: scroller.scrollTop + difference, behavior: "instant" });
    }
}
