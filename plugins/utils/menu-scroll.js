/** Keep long native menus stationary until the user explicitly scrolls. */
export function useManualMenuScroll(menu) {
    menu.scrollEl.addEventListener("mousemove", (event) => event.stopImmediatePropagation(), true);
    menu.scrollEl.addEventListener("pointerover", (event) => {
        if (event.pointerType === "touch") return;
        const row = event.target.closest?.(".menu-item:not(.is-disabled):not(.is-label)");
        const index = menu.items.findIndex((item) => item.dom === row);
        if (index < 0) return;
        event.stopPropagation();
        menu.items[menu.selected]?.dom.classList.remove("selected");
        menu.selected = index;
        row.classList.add("selected");
    }, true);
}
