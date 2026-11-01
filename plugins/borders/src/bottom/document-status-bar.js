import { Notice, setTooltip } from "obsidian";
import { getServiceRegistry } from "../../../utils/service-registry";
import { getWindowContext } from "../../../utils/windows";
import { scopeModule } from "../../../utils/module-scope";
import { setIcon } from "../utils/icons";
import { DocumentBreadcrumbNavigation } from "./document-breadcrumb-navigation";
import { DocumentEncodingMenu } from "./document-encoding-menu";

/** Footer presentation consumes snapshots; editor objects never cross this boundary. */
export class DocumentStatusBar {
    constructor(plugin, doc) {
        this.app = plugin.app; this.doc = doc; this.context = getWindowContext(doc);
        this.bar = doc.querySelector(".status-bar");
        if (!this.bar) return;
        this.scope = scopeModule(this.bar, "borders", { border: "bottom" });
        this.originalEnabled = doc.body.classList.contains("pw-document-footer-enabled");
        doc.body.classList.add("pw-document-footer-enabled");
        const create = (tag, cls) => this.bar.createEl(tag, { cls: `status-bar-item ${cls}` });
        this.breadcrumb = create("nav", "pw-status-path");
        this.position = create("span", "pw-status-position"); this.encoding = create("button", "pw-status-encoding");
        this.encoding.type = "button";
        this.encoding.setAttribute("aria-haspopup", "menu");
        this.encodingMenu = new DocumentEncodingMenu();
        this.encoding.addEventListener("click", () => this.encodingMenu.show(this.encoding, this.content, this.snapshot, this.context));
        this.lock = create("button", "clickable-icon pw-status-lock"); this.lock.type = "button";
        this.lock.addEventListener("click", () => {
            if (!this.content || !this.snapshot?.location) return;
            void this.content.toggleReadOnly(this.snapshot.location, this.context).catch(error => new Notice(error.message));
        });
        const anchor = (path, line) => Promise.resolve().then(() => {
            this.render();
            return [...this.breadcrumb.querySelectorAll("button")].find(button => button.dataset.path === path
                && button.dataset.line === (Number.isInteger(line) ? String(line) : undefined));
        });
        this.navigation = new DocumentBreadcrumbNavigation(plugin, doc, () => this.content,
            (file, line) => { this.folder = undefined; return anchor(file.path, line); },
            folder => { this.folder = folder; return anchor(folder.path); });
        this.stopProject = getServiceRegistry(this.app).watch("borders", "project", project => {
            this.stopSelection?.(); this.projectTarget = undefined;
            this.stopSelection = project?.onSelection((context, targets) => {
                if (context.windowId !== this.context.windowId || targets.length !== 1) return;
                this.projectTarget = targets[0]; this.folder = undefined; this.render();
            });
            this.render();
        });
        this.stop = getServiceRegistry(this.app).watch("borders", "content", content => {
            this.stopSnapshots?.(); this.navigation.close(); this.encodingMenu.dispose(); this.content = content; this.snapshot = undefined;
            this.stopSnapshots = content?.onDocument(snapshot => {
                if (snapshot.windowId !== this.context.windowId) return;
                const previous = this.snapshot;
                if (previous?.location?.path !== snapshot.location?.path || previous?.location?.leafId !== snapshot.location?.leafId || !snapshot.canChangeEncoding) this.encodingMenu.dispose();
                if (previous?.location?.leafId !== snapshot.location?.leafId || previous?.location?.path !== snapshot.location?.path) this.folder = undefined;
                if (previous?.canToggleReadOnly !== snapshot.canToggleReadOnly || previous?.readOnly !== snapshot.readOnly) this.navigation.close();
                if (previous?.location?.path !== snapshot.location?.path || previous?.location?.leafId !== snapshot.location?.leafId
                    || previous?.cursor?.line !== snapshot.cursor?.line || previous?.cursor?.column !== snapshot.cursor?.column) this.projectTarget = undefined;
                this.snapshot = snapshot; this.render();
            });
            this.render();
        });
    }

    pathButton(label, path, heading) {
        const button = this.breadcrumb.createEl("button", { text: label, attr: { type: "button", "aria-haspopup": "menu", "aria-expanded": "false" } });
        button.dataset.path = path;
        if (heading) button.dataset.line = String(heading.line);
        button.addEventListener("click", () => {
            const target = this.app.vault.getAbstractFileByPath(path);
            if (target) void this.navigation.show(button, target, this.snapshot?.location, heading).catch(error => new Notice(error.message));
        });
    }

    render() {
        if (!this.bar || this.disposed) return;
        const snapshot = this.snapshot;
        if (this.folder && this.app.vault.getAbstractFileByPath(this.folder.path) !== this.folder) this.folder = undefined;
        const path = this.folder?.path ?? this.projectTarget?.path ?? snapshot?.displayPath ?? "/";
        const trail = this.folder || this.projectTarget ? [] : snapshot?.activeHeadingTrail ?? [];
        const signature = JSON.stringify([this.app.vault.getName(), path, trail]);
        if (signature !== this.signature) {
            this.signature = signature;
            if (this.navigation.panels.length) this.navigation.close();
            this.breadcrumb.replaceChildren();
            this.pathButton(this.app.vault.getName(), "/");
            const parts = path === "/" ? [] : path.split("/");
            const separator = () => this.breadcrumb.createSpan({ cls: "pw-status-separator", text: "›" });
            parts.forEach((part, index) => { separator(); this.pathButton(part, parts.slice(0, index + 1).join("/")); });
            for (const heading of trail) { separator(); this.pathButton(heading.label, snapshot.location.path, heading); }
        }
        const cursor = snapshot?.cursor;
        this.position.textContent = cursor ? `${cursor.line + 1}:${cursor.column + 1}` : "";
        this.position.hidden = !cursor;
        this.encoding.textContent = [snapshot?.encoding, snapshot?.lineEnding].filter(Boolean).join(" · ") || "—";
        this.encoding.hidden = !snapshot?.location;
        this.encoding.disabled = !snapshot?.canChangeEncoding || !!snapshot?.encodingPending || !this.content?.setEncoding;
        setTooltip(this.encoding, "Change file encoding", { placement: "top" });
        this.lock.hidden = !snapshot?.location;
        this.lock.disabled = !snapshot?.canToggleReadOnly || !!snapshot?.lockPending;
        const icon = snapshot?.readOnly ? "status-file-lock" : "status-file-unlock";
        if (this.lock.dataset.icon !== icon) { setIcon(this.lock, icon); this.lock.dataset.icon = icon; }
        this.lock.setAttribute("aria-pressed", String(snapshot?.readOnly ?? false));
        setTooltip(this.lock, snapshot?.readOnly ? "Unlock file — allow editing" : "Lock file — read-only", { placement: "top" });
    }

    dispose() {
        this.disposed = true; this.stop?.(); this.stopSnapshots?.(); this.stopProject?.(); this.stopSelection?.(); this.navigation?.dispose(); this.encodingMenu?.dispose();
        for (const element of [this.breadcrumb, this.position, this.encoding, this.lock]) element?.remove();
        this.scope?.dispose();
        if (this.bar && !this.originalEnabled) this.doc.body.classList.remove("pw-document-footer-enabled");
    }
}
