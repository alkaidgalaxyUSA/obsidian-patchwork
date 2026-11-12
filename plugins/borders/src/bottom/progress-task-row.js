import { setIcon } from "../utils/icons";

/** Stable nodes keep pointer and keyboard targets intact while progress changes. */
export class ProgressTaskRow {
    constructor(doc, { compact = false, onCancel, onOpen }) {
        this.compact = compact;
        this.el = doc.createElement("div");
        this.el.className = "pw-progress-task";
        this.content = doc.createElement(compact ? "button" : "div");
        this.content.className = compact ? "pw-progress-trigger" : "pw-progress-content";
        if (compact) {
            this.content.type = "button";
            this.content.setAttribute("aria-haspopup", "dialog");
            this.content.setAttribute("aria-expanded", "false");
            this.content.addEventListener("click", () => onOpen());
        }
        this.title = doc.createElement("span"); this.title.className = "pw-progress-title";
        this.track = doc.createElement("span"); this.track.className = "pw-progress-track";
        this.track.setAttribute("role", "progressbar");
        this.track.setAttribute("aria-valuemin", "0"); this.track.setAttribute("aria-valuemax", "100");
        this.fill = doc.createElement("span"); this.fill.className = "pw-progress-fill";
        this.track.append(this.fill);
        this.details = doc.createElement("span"); this.details.className = "pw-progress-details";
        this.count = doc.createElement("span"); this.count.className = "pw-progress-count"; this.count.hidden = true;
        this.cancel = doc.createElement("button"); this.cancel.className = "pw-progress-cancel";
        this.cancel.type = "button"; setIcon(this.cancel, "x");
        this.cancel.addEventListener("click", () => { if (this.task) onCancel(this.task.id); });
        if (compact) {
            this.content.append(this.title, this.track, this.count);
            this.el.append(this.content, this.cancel);
        } else {
            const meter = doc.createElement("div"); meter.className = "pw-progress-meter";
            meter.append(this.track, this.cancel);
            this.content.append(this.title, meter, this.details);
            this.el.append(this.content);
        }
    }

    update(task, count = 1) {
        this.task = task;
        const stopping = task.state === "cancelling";
        const title = stopping ? `Stopping… ${task.title}` : task.title;
        if (this.title.textContent !== title) this.title.textContent = title;
        const details = task.cancellationError || task.details;
        if (this.details.textContent !== details) this.details.textContent = details;
        if (this.details.hidden !== !details) this.details.hidden = !details;
        this.attribute(this.el, "data-state", task.state);
        this.attribute(this.details, "data-error", String(!!task.cancellationError));
        this.attribute(this.content, "title", [title, details].filter(Boolean).join("\n"));
        this.attribute(this.track, "aria-label", title);
        this.attribute(this.track, "data-mode", task.fraction === null ? "indeterminate" : "determinate");
        if (task.fraction === null) {
            if (this.track.hasAttribute("aria-valuenow")) this.track.removeAttribute("aria-valuenow");
            this.attribute(this.track, "aria-valuetext", stopping ? "Stopping" : "In progress");
        } else {
            this.attribute(this.track, "aria-valuenow", String(Math.round(task.fraction * 100)));
            this.attribute(this.track, "aria-valuetext", `${Math.round(task.fraction * 100)}%`);
            const fraction = String(task.fraction);
            if (this.fill.style.getPropertyValue("--pw-borders-progress-fraction") !== fraction) {
                this.fill.style.setProperty("--pw-borders-progress-fraction", fraction);
            }
        }
        if (this.cancel.hidden !== !task.cancellable) this.cancel.hidden = !task.cancellable;
        if (this.cancel.disabled !== stopping) this.cancel.disabled = stopping;
        this.attribute(this.cancel, "aria-label", `Cancel ${task.title}`);
        this.attribute(this.cancel, "title", stopping ? "Waiting for the task to stop" : `Cancel ${task.title}`);
        if (this.compact) {
            const label = count > 1 ? String(count) : "";
            if (this.count.textContent !== label) this.count.textContent = label;
            if (this.count.hidden !== (count < 2)) this.count.hidden = count < 2;
            this.attribute(this.content, "aria-label", `${title}. Show ${count} background ${count === 1 ? "task" : "tasks"}`);
        }
    }

    attribute(element, name, value) {
        if (element.getAttribute(name) !== value) element.setAttribute(name, value);
    }

    dispose() { this.task = undefined; this.el.remove(); }
}
