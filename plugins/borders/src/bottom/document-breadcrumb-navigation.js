import { Notice, TFolder } from "obsidian";
import { setIcon } from "../utils/icons";
import { getWindowContext } from "../../../utils/windows";
import { scopeModule } from "../../../utils/module-scope";
import { ModuleUnavailableError } from "../../../utils/module-errors";

/** Single-level pickers that advance the document footer's breadcrumb path. */
export class DocumentBreadcrumbNavigation {
    constructor(plugin, doc, content, onHeading, onFolder) {
        this.plugin = plugin;
        this.app = plugin.app;
        this.doc = doc;
        this.content = content;
        this.cleanups = [];
        this.onHeading = onHeading;
        this.onFolder = onFolder;
        this.panels = [];
        this.revision = 0;
        const outside = event => {
            if (this.panels.some(panel => panel.el.contains(event.target)) || this.anchor?.contains(event.target)) return;
            this.close();
        };
        this.doc.addEventListener("pointerdown", outside, true);
        const resize = () => this.position();
        this.doc.defaultView.addEventListener("resize", resize);
        this.cleanups.push(() => this.doc.removeEventListener("pointerdown", outside, true), () => this.doc.defaultView?.removeEventListener("resize", resize));
        for (const event of ["rename", "delete"]) {
            const ref = this.app.vault.on(event, () => this.close());
            this.cleanups.push(() => this.app.vault.offref(ref));
        }
    }

    api() {
        const api = this.content();
        if (!api) throw new ModuleUnavailableError("content", "Enable Content to navigate document headings.");
        return api;
    }

    async show(anchor, target, location, heading) {
        if (this.anchor === anchor && this.panels.length) { this.close(); return; }
        this.close(); this.anchor = anchor; this.location = location;
        if (target instanceof TFolder) { this.folder(target, anchor); return; }
        if (!location) return;
        const revision = this.revision;
        const roots = await this.api().getHeadings(location, getWindowContext(this.doc));
        if (revision !== this.revision || !anchor.isConnected) return;
        const find = nodes => nodes.flatMap(node => [node, ...find(node.children)]).find(node => node.id === heading?.id);
        this.headingPanel(target, heading ? find(roots)?.children ?? [] : roots, anchor, heading?.label);
    }

    folder(folder, anchor) {
        const children = [...folder.children].sort((left, right) => {
            const folders = Number(right instanceof TFolder) - Number(left instanceof TFolder);
            return folders || left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" });
        });
        const rows = children.map(file => ({
            label: file.name,
            icon: file instanceof TFolder ? "folder" : "file-text",
            path: file.path,
            action: async () => {
                if (file instanceof TFolder) { await this.advance(file); return; }
                const revision = this.revision;
                await this.openFile(file);
                if (revision !== this.revision) return;
                await this.advance(file);
            },
        }));
        this.panel(anchor, folder.path === "/" ? this.app.vault.getName() : folder.path, rows);
    }

    headingPanel(file, nodes, anchor, title) {
        const rows = nodes.map(node => ({
            label: node.label, icon: "heading", line: node.line,
            action: async () => {
                const revision = this.revision;
                const location = await this.openFile(file);
                if (revision !== this.revision) return;
                await this.api().navigate({ ...location, line: node.line }, getWindowContext(this.doc));
                if (revision !== this.revision) return;
                await this.advance(file, node.line);
            },
        }));
        this.panel(anchor, title || file.name, rows);
    }

    async openFile(file) {
        if (this.app.vault.getAbstractFileByPath(file.path) !== file) throw new Error("This file is no longer available.");
        const location = await this.api().openDocument({ ...getWindowContext(this.doc), path: file.path,
            target: "new-tab", groupLeafId: this.location?.leafId, focus: true });
        this.location = location;
        return location;
    }

    async advance(target, line) {
        this.close();
        const revision = this.revision;
        const folder = target instanceof TFolder;
        const anchor = await (folder ? this.onFolder(target) : this.onHeading(target, line));
        if (revision !== this.revision || !anchor?.isConnected) return;
        if (folder && target.children.length || !folder) anchor.click();
    }

    panel(anchor, title, rows) {
        if (!rows.length) return;
        this.trim(0);
        const el = this.doc.createElement("div");
        el.className = "menu pw-breadcrumb-menu";
        el.setAttribute("role", "menu");
        el.setAttribute("aria-label", title);
        const list = el.createDiv({ cls: "menu-scroll pw-breadcrumb-menu-list" });
        const panel = { el, anchor, rect: anchor.getBoundingClientRect(), rows: [] };
        for (const row of rows) {
            const button = list.createEl("button", { cls: "menu-item pw-breadcrumb-menu-row", attr: { type: "button", role: "menuitem" } });
            if (row.path !== undefined) button.dataset.path = row.path;
            if (row.line !== undefined) button.dataset.line = String(row.line);
            setIcon(button.createSpan({ cls: "pw-breadcrumb-menu-icon" }), row.icon);
            button.createSpan({ cls: "pw-breadcrumb-menu-label", text: row.label });
            button.addEventListener("click", () => {
                this.revision++;
                for (const item of panel.rows) item.classList.toggle("is-selected", item === button);
                void row.action(button).catch(error => new Notice(error.message ?? "Could not navigate to this item."));
            });
            panel.rows.push(button);
        }
        el.addEventListener("keydown", event => this.keydown(event, panel));
        el.tabIndex = -1;
        const scope = scopeModule(el, "borders", { border: "bottom" });
        scope.refreshTokens(anchor);
        panel.scope = scope;
        this.doc.body.append(el);
        this.panels.push(panel);
        anchor.setAttribute("aria-expanded", "true");
        this.position();
        (panel.rows[0] ?? el).focus();
    }

    position() {
        const win = this.doc.defaultView;
        const bottom = (this.doc.querySelector(".status-bar")?.getBoundingClientRect().top ?? win.innerHeight) - 4;
        for (const panel of this.panels) {
            if (panel.anchor.isConnected) panel.rect = panel.anchor.getBoundingClientRect();
            const anchor = panel.rect;
            panel.el.style.maxHeight = `${Math.max(40, bottom - 8)}px`;
            const bounds = panel.el.getBoundingClientRect();
            const left = anchor.left;
            const top = anchor.top - bounds.height - 4;
            panel.el.style.left = `${Math.max(8, Math.min(left, win.innerWidth - bounds.width - 8))}px`;
            panel.el.style.top = `${Math.max(8, Math.min(top, bottom - bounds.height))}px`;
        }
    }

    keydown(event, panel) {
        const index = panel.rows.indexOf(this.doc.activeElement);
        const moves = { ArrowDown: 1, ArrowUp: -1 };
        if (moves[event.key] && panel.rows.length) {
            event.preventDefault();
            panel.rows[(index + moves[event.key] + panel.rows.length) % panel.rows.length].focus();
            return;
        }
        if (event.key !== "Escape") return;
        event.preventDefault(); event.stopPropagation();
        const anchor = this.anchor;
        this.close();
        if (anchor?.isConnected) anchor.focus();
    }

    trim(depth) {
        for (const panel of this.panels.splice(depth)) {
            panel.anchor.setAttribute("aria-expanded", "false");
            panel.scope.dispose();
            panel.el.remove();
        }
    }

    close() { this.revision++; this.trim(0); this.anchor = undefined; }
    dispose() { this.close(); for (const remove of this.cleanups) remove(); this.cleanups = []; }
}
