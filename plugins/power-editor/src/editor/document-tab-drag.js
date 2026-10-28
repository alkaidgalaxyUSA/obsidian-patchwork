/** Lightweight same-group preview; commit order once on drop, keep native external drops. */
export function installDocumentTabDrag(app, tabs) {
    const container = tabs.tabHeaderContainerEl;
    const inner = tabs.tabsInnerEl;
    const doc = container.ownerDocument;
    const win = doc.defaultView;
    let drag;
    let frame = 0;
    const clearPreview = () => {
        win.cancelAnimationFrame(frame);
        frame = 0;
        if (!drag?.preview) return;
        container.classList.remove("pw-tab-dragging");
        doc.body.classList.remove("pw-tab-gap-preview");
        drag.preview = false;
        drag.position = -1;
        inner.style.removeProperty("--pw-tab-gap-width");
        inner.style.removeProperty("--pw-tab-gap-left");
        drag.source.tabHeaderEl.classList.remove("pw-tab-drag-source");
        for (const item of drag.items) item.leaf.tabHeaderEl.style.removeProperty("--pw-tab-drag-x");
    };
    const finish = () => {
        clearPreview();
        if (drag) {
            win.clearTimeout(drag.ghostTimer);
            drag.ghost.remove();
            if (app.workspace.getDropDirection === drag.direction) app.workspace.getDropDirection = drag.nativeDirection;
        }
        drag = undefined;
    };
    const inside = (event) => event.clientX >= drag.bounds.left && event.clientX <= drag.bounds.right
        && event.clientY >= drag.bounds.top && event.clientY <= drag.bounds.bottom;
    const locate = (x, scroll) => {
        const point = x - drag.bounds.left + scroll;
        let low = 0;
        let high = drag.items.length;
        while (low < high) {
            const mid = (low + high) >>> 1;
            if (point > drag.items[mid].midpoint) low = mid + 1;
            else high = mid;
        }
        // Use the original slots, including the source, so a wide dragged tab
        // does not jump across narrow neighbours while still over its own slot.
        return low > drag.sourceIndex ? low - 1 : low;
    };
    const updatePosition = (position) => {
        if (position === drag.position) return;
        drag.position = position;
        for (let index = 0; index < drag.others.length; index++) {
            const item = drag.others[index];
            const left = item.compactLeft + (index >= position ? drag.width + drag.gap : 0);
            item.leaf.tabHeaderEl.style.setProperty("--pw-tab-drag-x", `${left - item.left}px`);
        }
        const left = drag.others[position]?.compactLeft ?? drag.end;
        inner.style.setProperty("--pw-tab-gap-left", `${left}px`);
    };
    const paint = (time) => {
        frame = 0;
        if (!drag?.preview) return;
        const elapsed = Math.min(32, time - drag.lastFrame);
        drag.lastFrame = time;
        const bounds = drag.bounds;
        const edge = 32;
        const speed = drag.x < bounds.left + edge ? -Math.min(0.6, (bounds.left + edge - drag.x) / 50)
            : drag.x > bounds.right - edge ? Math.min(0.6, (drag.x - bounds.right + edge) / 50) : 0;
        const before = inner.scrollLeft;
        if (speed) inner.scrollLeft += speed * elapsed;
        const scroll = inner.scrollLeft;
        updatePosition(locate(drag.x, scroll));
        if (scroll !== before) frame = win.requestAnimationFrame(paint);
    };
    const schedule = () => { if (!frame) frame = win.requestAnimationFrame(paint); };
    const showPreview = () => {
        if (drag.preview) return;
        drag.preview = true;
        drag.lastFrame = win.performance.now();
        container.classList.add("pw-tab-dragging");
        doc.body.classList.add("pw-tab-gap-preview");
        drag.source.tabHeaderEl.classList.add("pw-tab-drag-source");
        inner.style.setProperty("--pw-tab-gap-width", `${drag.width}px`);
    };
    const start = (event) => {
        const header = event.target.closest?.(".workspace-tab-header");
        const source = tabs.children.find((leaf) => leaf.tabHeaderEl === header);
        if (!source || tabs.isStacked || !event.dataTransfer) return;
        finish();
        // All size reads happen once, before writing preview styles.
        const bounds = inner.getBoundingClientRect();
        const scroll = inner.scrollLeft;
        const items = tabs.children.map((leaf) => {
            const rect = leaf.tabHeaderEl.getBoundingClientRect();
            const left = rect.left - bounds.left + scroll;
            return { leaf, width: rect.width, left, midpoint: left + rect.width / 2 };
        });
        const sourceIndex = tabs.children.indexOf(source);
        const width = items[sourceIndex].width;
        const gap = parseFloat(win.getComputedStyle(inner).columnGap) || 0;
        const titleStyle = win.getComputedStyle(source.tabHeaderInnerTitleEl);
        const others = items.filter((item) => item.leaf !== source);
        let left = items[0].left;
        for (const item of others) {
            item.compactLeft = left;
            left += item.width + gap;
        }
        const ghost = doc.createElement("div");
        ghost.className = "pw-tab-drag-ghost";
        ghost.textContent = source.view.getDisplayText();
        Object.assign(ghost.style, { width: `${width}px`, height: `${bounds.height}px`, font: titleStyle.font,
            left: `${bounds.left + items[sourceIndex].left - scroll}px`, top: `${bounds.top}px` });
        doc.body.appendChild(ghost);
        const anchor = Math.max(0, Math.min(width, event.clientX - bounds.left - items[sourceIndex].left + scroll));
        event.dataTransfer.setDragImage(ghost, anchor, Math.max(0, event.clientY - bounds.top));
        drag = { source, items, others, sourceIndex, width, gap, bounds, end: left, ghost,
            x: event.clientX, preview: false, position: -1, ghostTimer: win.setTimeout(() => ghost.remove(), 0) };
        const nativeDirection = app.workspace.getDropDirection;
        drag.nativeDirection = nativeDirection;
        drag.direction = function (event, rect, directions, target) {
            if (drag?.preview && target === tabs && inside(event)) return "center";
            return nativeDirection.call(this, event, rect, directions, target);
        };
        app.workspace.getDropDirection = drag.direction;
        // Start with the original slot immediately, without waiting for dragover.
        showPreview();
        updatePosition(sourceIndex);
    };
    const over = (event) => {
        if (!drag) return;
        if (!inside(event) || drag.source.parent !== tabs || tabs.isStacked) {
            clearPreview();
            return;
        }
        drag.x = event.clientX;
        showPreview();
        schedule();
        if (event.type === "dragenter") return; // Native bookkeeping clears outside-window state.
        event.preventDefault();
        event.stopPropagation();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    };
    const drop = (event) => {
        if (!drag?.preview || !inside(event) || drag.source.parent !== tabs) return;
        event.preventDefault();
        event.stopPropagation();
        const source = drag.source;
        const originalIndex = tabs.children.indexOf(source);
        const position = locate(event.clientX, inner.scrollLeft);
        // Discard cached geometry if another operation changed the group mid-drag.
        const unchanged = drag.items.length === tabs.children.length
            && drag.items.every((item, index) => item.leaf === tabs.children[index]);
        finish();
        if (!unchanged) return;
        if (position !== originalIndex) {
            tabs.removeChild(source);
            tabs.insertChild(position, source);
            // Reconcile existing DOM immediately, without native enter/exit animation.
            inner.insertBefore(source.tabHeaderEl, tabs.children[position + 1]?.tabHeaderEl ?? null);
        }
        if (tabs.currentTab === position) tabs.updateTabDisplay();
        else tabs.selectTabIndex(position);
        app.workspace.setActiveLeaf(source, { focus: true });
        app.workspace.trigger("patchwork:document-tab-activated", source);
    };
    const leave = (event) => { if (!event.relatedTarget) clearPreview(); };
    const end = () => queueMicrotask(finish);
    container.addEventListener("dragstart", start);
    win.addEventListener("dragover", over, true);
    win.addEventListener("dragenter", over, true);
    win.addEventListener("dragleave", leave);
    win.addEventListener("drop", drop, true);
    win.addEventListener("drop", end);
    win.addEventListener("dragend", end);
    win.addEventListener("resize", finish);
    return () => {
        finish();
        container.removeEventListener("dragstart", start);
        win.removeEventListener("dragover", over, true);
        win.removeEventListener("dragenter", over, true);
        win.removeEventListener("dragleave", leave);
        win.removeEventListener("drop", drop, true);
        win.removeEventListener("drop", end);
        win.removeEventListener("dragend", end);
        win.removeEventListener("resize", finish);
    };
}
