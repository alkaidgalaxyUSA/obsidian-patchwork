/** Share application focus across the main window, popouts and native dialogs. */
export class AppFocus {
    constructor(win) {
        this.documents = new Map();
        this.win = win;
        this.schedule = () => {
            if (this.timer !== undefined) return;
            this.timer = win.setTimeout(() => { this.timer = undefined; this.refresh(); }, 0);
        };
        try { this.remote = win.require?.("@electron/remote"); }
        catch { /* Browser-only windows use the registered documents instead. */ }
        this.remote?.app.on("browser-window-focus", this.schedule);
        this.remote?.app.on("browser-window-blur", this.schedule);
    }

    add(doc) {
        this.documents.set(doc, { previous: doc.body.getAttribute("data-pw-app-focused"), applied: undefined });
        doc.defaultView.addEventListener("focus", this.schedule);
        doc.defaultView.addEventListener("blur", this.schedule);
        this.refresh();
        return () => {
            doc.defaultView?.removeEventListener("focus", this.schedule);
            doc.defaultView?.removeEventListener("blur", this.schedule);
            const lease = this.documents.get(doc);
            this.documents.delete(doc);
            if (doc.body.getAttribute("data-pw-app-focused") !== lease.applied) return;
            if (lease.previous === null) doc.body.removeAttribute("data-pw-app-focused");
            else doc.body.setAttribute("data-pw-app-focused", lease.previous);
        };
    }

    refresh() {
        const focused = this.remote ? !!this.remote.BrowserWindow.getFocusedWindow()
            : [...this.documents.keys()].some(doc => doc.hasFocus());
        const value = String(focused);
        for (const [doc, lease] of this.documents) {
            if (doc.body.getAttribute("data-pw-app-focused") !== value) doc.body.setAttribute("data-pw-app-focused", value);
            lease.applied = value;
        }
    }

    dispose() {
        if (this.timer !== undefined) this.win.clearTimeout(this.timer);
        this.remote?.app.removeListener("browser-window-focus", this.schedule);
        this.remote?.app.removeListener("browser-window-blur", this.schedule);
    }
}
