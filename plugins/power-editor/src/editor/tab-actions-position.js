/** Offset the last document group's controls without clipping or moving its tabs. */
export class TabActionsPosition {
    constructor(doc) {
        this.doc = doc;
        this.entries = [];
        this.previousActionsLeft = doc.body.style.getPropertyValue("--pw-titlebar-actions-left");
    }

    sync() {
        const root = this.doc.querySelector(".workspace-split.mod-root");
        const right = root?.getBoundingClientRect().right;
        const container = [...this.doc.querySelectorAll(".mod-root .workspace-tabs.mod-top > .pw-document-tab-strip")]
            .find((element) => element.getBoundingClientRect().width > 0 && Math.abs(element.getBoundingClientRect().right - right) < 1);
        const buttons = container ? [container.querySelector(":scope > .pw-tab-overflow"),
            container.querySelector(":scope > .workspace-tab-header-tab-list")] : [];
        if (container !== this.container || buttons.some((button, index) => button !== this.entries[index]?.button)) {
            this.dispose();
            if (!container || buttons.some((button) => !button)) return;
            this.container = container;
            this.entries = buttons.map((button) => {
                const style = this.doc.defaultView.getComputedStyle(button);
                const slot = this.doc.createElement("div");
                slot.className = "pw-tab-action-slot";
                slot.setAttribute("aria-hidden", "true");
                Object.assign(slot.style, { width: style.width, height: style.height, margin: style.margin, alignSelf: style.alignSelf });
                slot.hidden = button.hidden;
                button.before(slot);
                button.classList.add("pw-tab-action-positioned");
                return { button, slot };
            });
            container.classList.add("pw-tab-actions-offset");
            this.observer = new this.doc.defaultView.MutationObserver(() => this.position());
            for (const { button } of this.entries) this.observer.observe(button, { attributes: true, attributeFilter: ["hidden"] });
            this.resize = new this.doc.defaultView.ResizeObserver(() => this.position());
            this.resize.observe(container);
            for (const { slot } of this.entries) this.resize.observe(slot);
        }
        this.position();
    }

    position() {
        if (!this.container?.isConnected) return;
        const win = this.doc.defaultView;
        for (const { button, slot } of this.entries) {
            slot.hidden = button.hidden;
            // A hidden overflow button can have no computed width when first attached.
            if (!button.hidden) slot.style.width = win.getComputedStyle(button).width;
        }
        const controls = this.doc.querySelector(".titlebar-button-container.mod-right");
        const settings = this.doc.querySelector(".pw-window-settings");
        const shortcuts = this.doc.querySelector(".pw-titlebar-shortcuts:not(:empty)");
        const limit = (shortcuts ?? settings ?? controls)?.getBoundingClientRect().left ?? win.innerWidth;
        const unit = Number.parseFloat(win.getComputedStyle(this.doc.body).getPropertyValue("--pw-window-control-width")) || 44;
        const style = win.getComputedStyle(this.doc.body);
        const gap = Number.parseFloat(style.getPropertyValue("--pw-tab-actions-gap")) || 11;
        const height = Number.parseFloat(style.getPropertyValue("--pw-header-action-size")) || 28;
        const offset = Number.parseFloat(style.getPropertyValue("--pw-header-action-offset")) || 0;
        const visible = this.entries.filter(({ button }) => !button.hidden);
        const width = visible.reduce((total, { slot }) => total + slot.getBoundingClientRect().width, 0) + Math.max(0, visible.length - 1) * gap;
        const start = visible[0]?.slot.getBoundingClientRect().left ?? limit;
        const shift = Math.max(0, Math.min(5 * unit, limit - start - width - 8));
        const header = this.container.getBoundingClientRect();
        const actionsLeft = Math.max(0, Math.min(start + shift, limit - width - 8));
        let left = actionsLeft;
        for (const { button, slot } of visible) {
            button.style.setProperty("--pw-tab-action-left", `${left}px`);
            button.style.setProperty("--pw-tab-action-top", `${header.top + (header.height - height) / 2 + offset}px`);
            button.style.setProperty("--pw-tab-action-height", `${height}px`);
            left += slot.getBoundingClientRect().width + gap;
        }
        this.doc.body.style.setProperty("--pw-titlebar-actions-left", `${Math.min(limit, actionsLeft)}px`);
    }

    dispose() {
        this.observer?.disconnect();
        this.resize?.disconnect();
        for (const { button, slot } of this.entries) {
            button.classList.remove("pw-tab-action-positioned");
            for (const name of ["left", "top", "height"]) button.style.removeProperty(`--pw-tab-action-${name}`);
            slot.remove();
        }
        this.entries = [];
        this.container?.classList.remove("pw-tab-actions-offset");
        this.container = undefined;
        if (this.previousActionsLeft) this.doc.body.style.setProperty("--pw-titlebar-actions-left", this.previousActionsLeft);
        else this.doc.body.style.removeProperty("--pw-titlebar-actions-left");
    }
}
