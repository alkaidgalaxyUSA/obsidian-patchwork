/** Feature detection for the native tree APIs used by Project enhancements. */
export function canEnhanceExplorer(view) {
    return !!view.tree?.scope?.keys && !!view.tree?.selectedDoms && !!view.fileItems && !!view.search?.searchComponent
        && typeof view.getSortedFolderItems === "function" && typeof view.sort === "function"
        && typeof view.revealInFolder === "function" && typeof view.tree.selectItem === "function"
        && typeof view.tree.clearSelectedDoms === "function" && typeof view.tree.setFocusedItem === "function"
        && typeof view.tree.setSearchFilter === "function" && typeof view.tree.infinityScroll?.invalidateAll === "function"
        && typeof view.search.searchComponent.onChange === "function" && typeof view.search.searchComponent.getValue === "function"
        && !!view.search.searchComponent.inputEl && !!view.search.searchComponent.containerEl;
}

/** Restore only the native visibility attributes changed by the initial hide. */
export function hideExplorerSearch(view) {
    const search = view.search;
    if (typeof search?.hide !== "function") return () => {};
    const elements = [];
    for (let element = search.containerEl ?? search.searchComponent?.containerEl; element && view.containerEl.contains(element); element = element.parentElement) {
        elements.push(element);
        if (element === view.containerEl) break;
    }
    const names = ["style", "class", "hidden", "aria-hidden"];
    const before = elements.flatMap(element => names.map(name => ({ element, name, previous: element.getAttribute(name) })));
    const visible = elements.length > 0 && elements.every(element => element.ownerDocument.defaultView.getComputedStyle(element).display !== "none");
    search.hide();
    const leases = before.map(lease => ({ ...lease, applied: lease.element.getAttribute(lease.name) }))
        .filter(lease => lease.previous !== lease.applied);
    return () => {
        if (visible && leases.length && leases.every(lease => lease.element.getAttribute(lease.name) === lease.applied)) search.show?.();
        for (const { element, name, previous, applied } of leases) {
            if (element.getAttribute(name) !== applied) continue;
            if (previous === null) element.removeAttribute(name); else element.setAttribute(name, previous);
        }
    };
}
