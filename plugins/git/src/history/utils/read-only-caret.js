/** Show the native selection's insertion position without making history editable. */
export function readOnlyCaret(viewport, host, registerCleanup) {
    const doc = viewport.ownerDocument, win = doc.defaultView;
    viewport.tabIndex = 0;
    const caret = host.createDiv({ cls: "pw-diff-readonly-caret", attr: { "aria-hidden": "true" } });
    let frame, press;
    const paint = () => {
        frame = undefined;
        caret.hidden = true;
        const selection = doc.getSelection();
        if (doc.activeElement !== viewport || !selection?.isCollapsed || !selection.rangeCount || !viewport.contains(selection.anchorNode)) return;
        const range = selection.getRangeAt(0);
        let rect = range.getBoundingClientRect();
        const emptyRow = range.startContainer.nodeType === 1 ? range.startContainer.closest(".pw-diff-cell") : undefined;
        if (!rect.height && emptyRow && !emptyRow.textContent) rect = emptyRow.getBoundingClientRect();
        const bounds = viewport.getBoundingClientRect(), origin = host.getBoundingClientRect();
        if (emptyRow && !emptyRow.textContent) rect = { left: bounds.left + viewport.clientLeft + 2, top: rect.top, bottom: rect.bottom, height: rect.height };
        if (!rect.height || rect.left < bounds.left + viewport.clientLeft || rect.left > bounds.left + viewport.clientLeft + viewport.clientWidth || rect.top < bounds.top || rect.bottom > bounds.top + viewport.clientHeight) return;
        Object.assign(caret.style, { left: `${rect.left - origin.left}px`, top: `${rect.top - origin.top}px`, height: `${rect.height}px` });
        caret.hidden = false;
    };
    const update = () => { if (frame === undefined) frame = win.requestAnimationFrame(paint); };
    const focus = event => {
        const row = event.target.closest(".pw-diff-cell");
        const selection = doc.getSelection();
        if (row && !row.textContent && selection && press && Math.abs(event.clientX - press.x) < 3 && Math.abs(event.clientY - press.y) < 3) {
            const range = doc.createRange();
            range.selectNodeContents(row); range.collapse(true);
            selection.removeAllRanges(); selection.addRange(range);
        }
        press = undefined;
        viewport.focus({ preventScroll: true }); update();
    };
    const down = event => { press = event.button === 0 ? { x: event.clientX, y: event.clientY } : undefined; };
    const keydown = event => {
        const directions = { ArrowLeft: "backward", ArrowRight: "forward", ArrowUp: "backward", ArrowDown: "forward" };
        if (!directions[event.key] || event.altKey || event.metaKey) return;
        const selection = doc.getSelection();
        if (!selection?.rangeCount || !viewport.contains(selection.anchorNode)) return;
        event.preventDefault();
        const previous = selection.getRangeAt(0).cloneRange();
        selection.modify(event.shiftKey ? "extend" : "move", directions[event.key], event.key === "ArrowUp" || event.key === "ArrowDown" ? "line" : event.ctrlKey ? "word" : "character");
        if (!viewport.contains(selection.focusNode)) { selection.removeAllRanges(); selection.addRange(previous); }
        update();
    };
    const listeners = [[doc, "selectionchange", update], [viewport, "pointerdown", down], [viewport, "pointerup", focus], [viewport, "keydown", keydown], [viewport, "blur", update], [viewport, "scroll", update], [win, "resize", update]];
    for (const [target, event, listener] of listeners) target.addEventListener(event, listener);
    const observer = new win.ResizeObserver(update);
    observer.observe(viewport);
    registerCleanup(() => {
        if (frame !== undefined) win.cancelAnimationFrame(frame);
        observer.disconnect();
        for (const [target, event, listener] of listeners) target.removeEventListener(event, listener);
        caret.remove();
    });
}
