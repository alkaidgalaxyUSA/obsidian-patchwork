/** Position only the container and controls explicitly leased by Content. */
export class TabActionsPosition {
    constructor(contribution) {
        this.contribution = contribution;
        this.doc = contribution.context.document;
        this.entries = [];
    }

    sync() {
        const { container, controls } = this.contribution;
        const right = this.doc.querySelector(".workspace-split.mod-root")?.getBoundingClientRect().right;
        const rect = container.getBoundingClientRect();
        if (!container.isConnected || rect.width <= 0 || Math.abs(rect.right - right) >= 1 || controls.some(button => !container.contains(button))) {
            this.release(); return;
        }
        if (!this.entries.length) {
            this.container = container;
            this.previousClass = container.classList.contains("pw-tab-actions-offset");
            this.previousLeft = this.doc.body.style.getPropertyValue("--pw-titlebar-actions-left");
            this.previousPriority = this.doc.body.style.getPropertyPriority("--pw-titlebar-actions-left");
            this.entries = controls.map(button => {
                const style = this.doc.defaultView.getComputedStyle(button), slot = this.doc.createElement("div");
                slot.className = "pw-tab-action-slot"; slot.setAttribute("aria-hidden", "true");
                Object.assign(slot.style, { width: style.width, height: style.height, margin: style.margin, alignSelf: style.alignSelf });
                slot.hidden = button.hidden; button.before(slot);
                const hadClass = button.classList.contains("pw-tab-action-positioned");
                const properties = ["left", "top", "height"].map(name => [name, button.style.getPropertyValue(`--pw-tab-action-${name}`), button.style.getPropertyPriority(`--pw-tab-action-${name}`)]);
                button.classList.add("pw-tab-action-positioned");
                return { button, slot, hadClass, properties };
            });
            container.classList.add("pw-tab-actions-offset");
            this.observer = new this.doc.defaultView.MutationObserver(() => this.position());
            for (const { button } of this.entries) this.observer.observe(button, { attributes: true, attributeFilter: ["hidden"] });
            this.resize = new this.doc.defaultView.ResizeObserver(() => this.position()); this.resize.observe(container);
        }
        this.position();
    }

    position() {
        if (!this.container?.isConnected) return;
        const win = this.doc.defaultView;
        for (const { button, slot } of this.entries) {
            slot.hidden = button.hidden;
            if (!button.hidden) slot.style.width = win.getComputedStyle(button).width;
        }
        const controls = this.doc.querySelector(".titlebar-button-container.mod-right");
        const settings = this.doc.querySelector(".pw-window-settings");
        const shortcuts = this.doc.querySelector(".pw-titlebar-shortcuts:not(:empty)");
        const limit = (shortcuts ?? settings ?? controls)?.getBoundingClientRect().left ?? win.innerWidth;
        const style = win.getComputedStyle(this.doc.body);
        const unit = Number.parseFloat(style.getPropertyValue("--pw-window-control-width")) || 44;
        const gap = Number.parseFloat(style.getPropertyValue("--pw-tab-actions-gap")) || 11;
        const height = Number.parseFloat(style.getPropertyValue("--pw-header-action-size")) || 28;
        const offset = Number.parseFloat(style.getPropertyValue("--pw-header-action-offset")) || 0;
        const visible = this.entries.filter(({ button }) => !button.hidden);
        const width = visible.reduce((sum, { slot }) => sum + slot.getBoundingClientRect().width, 0) + Math.max(0, visible.length - 1) * gap;
        const start = visible[0]?.slot.getBoundingClientRect().left ?? limit;
        const shift = Math.max(0, Math.min(5 * unit, limit - start - width - 8));
        const header = this.container.getBoundingClientRect();
        const actionsLeft = Math.max(0, Math.min(start + shift, limit - width - 8));
        let left = actionsLeft;
        for (const entry of visible) {
            const { button, slot } = entry;
            entry.applied = { left: `${left}px`, top: `${header.top + (header.height - height) / 2 + offset}px`, height: `${height}px` };
            for (const [name, value] of Object.entries(entry.applied)) button.style.setProperty(`--pw-tab-action-${name}`, value);
            left += slot.getBoundingClientRect().width + gap;
        }
        this.appliedLeft = `${Math.min(limit, actionsLeft)}px`;
        this.doc.body.style.setProperty("--pw-titlebar-actions-left", this.appliedLeft);
    }

    release() {
        if (!this.entries.length) return;
        this.observer?.disconnect(); this.resize?.disconnect();
        for (const { button, slot, hadClass, properties, applied } of this.entries) {
            if (!hadClass) button.classList.remove("pw-tab-action-positioned");
            for (const [name, value, priority] of properties) {
                if (button.style.getPropertyValue(`--pw-tab-action-${name}`) !== applied?.[name]) continue;
                if (value) button.style.setProperty(`--pw-tab-action-${name}`, value, priority);
                else button.style.removeProperty(`--pw-tab-action-${name}`);
            }
            slot.remove();
        }
        if (!this.previousClass) this.container.classList.remove("pw-tab-actions-offset");
        if (this.doc.body.style.getPropertyValue("--pw-titlebar-actions-left") === this.appliedLeft) {
            if (this.previousLeft) this.doc.body.style.setProperty("--pw-titlebar-actions-left", this.previousLeft, this.previousPriority);
            else this.doc.body.style.removeProperty("--pw-titlebar-actions-left");
        }
        this.entries = []; this.container = undefined;
    }

    dispose() { this.release(); }
}
