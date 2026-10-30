import { Notice, TFolder } from "obsidian";
import { setIcon } from "../../../utils/icons";
import { noteHeadings } from "../utils/note-headings";
import { outlineLabel } from "./utils/outline-headings";
import { scrollDocumentHeading } from "./utils/document-heading-scroll";

/** Single-level pickers that advance the document footer's breadcrumb path. */
export class DocumentBreadcrumbNavigation {
    constructor(plugin, onHeading, onFolder) {
        this.plugin = plugin;
        this.app = plugin.app;
        this.doc = this.app.workspace.containerEl.ownerDocument;
        this.onHeading = onHeading;
        this.onFolder = onFolder;
        this.panels = [];
        this.revision = 0;
        plugin.registerDomEvent(this.doc, "pointerdown", event => {
            if (this.panels.some(panel => panel.el.contains(event.target)) || this.anchor?.contains(event.target)) return;
            this.close();
        }, true);
        plugin.registerDomEvent(this.doc.defaultView, "resize", () => this.position());
        plugin.registerEvent(this.app.vault.on("rename", () => this.close()));
        plugin.registerEvent(this.app.vault.on("delete", () => this.close()));
    }

    headings(file) {
        if (file?.extension !== "md") return [];
        const roots = [];
        const stack = [];
        for (const heading of noteHeadings(this.app, file)) {
            const node = { heading, children: [] };
            while (stack.length && stack.at(-1).heading.level >= heading.level) stack.pop();
            (stack.at(-1)?.children ?? roots).push(node);
            stack.push(node);
        }
        return roots;
    }

    trail(file, line) {
        if (!Number.isInteger(line)) return [];
        const trail = [];
        let nodes = this.headings(file);
        while (nodes.length) {
            const node = nodes.findLast(item => item.heading.position.start.line <= line);
            if (!node) break;
            trail.push(node);
            nodes = node.children;
        }
        return trail;
    }

    show(anchor, target, leaf, heading) {
        if (this.anchor === anchor && this.panels.length) { this.close(); return; }
        this.close();
        this.anchor = anchor;
        this.leaf = leaf;
        if (target instanceof TFolder) { this.folder(target, anchor); return; }
        if (target?.extension === "md") {
            const current = heading && this.trail(target, heading.heading.position.start.line).at(-1);
            const nodes = heading ? current?.children ?? [] : this.headings(target);
            this.headingPanel(target, nodes, anchor, heading?.heading.heading);
        }
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
            label: outlineLabel(node.heading.heading) || node.heading.heading,
            icon: "heading",
            line: node.heading.position.start.line,
            action: async () => {
                const revision = this.revision;
                const leaf = await this.openFile(file);
                if (revision !== this.revision || leaf?.view.file !== file) return;
                const line = node.heading.position.start.line;
                const view = leaf.view;
                const current = () => revision === this.revision && leaf.view === view && view.file === file
                    && this.app.workspace.isAttached(leaf);
                await scrollDocumentHeading(view, node.heading, current);
                if (!current()) return;
                await this.advance(file, line);
            },
        }));
        this.panel(anchor, title ? outlineLabel(title) : file.name, rows);
    }

    async openFile(file) {
        if (this.app.vault.getAbstractFileByPath(file.path) !== file) throw new Error("This file is no longer available.");
        const tabs = this.leaf?.parent;
        if (!tabs || !this.app.workspace.isAttached(this.leaf)) throw new Error("The document group was closed. Open the navigation again.");
        await this.plugin.documentTabMenu.open({ path: file.path, label: file.name }, tabs);
        const leaf = tabs.children.find(item => item.view.file === file);
        if (leaf) this.leaf = leaf;
        return leaf;
    }

    async advance(target, line) {
        this.close();
        const revision = this.revision;
        const folder = target instanceof TFolder;
        const anchor = await (folder ? this.onFolder(target) : this.onHeading(target, line));
        if (revision !== this.revision || !anchor?.isConnected) return;
        const options = folder ? target.children : Number.isInteger(line)
            ? this.trail(target, line).at(-1)?.children : this.headings(target);
        if (options?.length) anchor.click();
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
            panel.el.remove();
        }
    }

    close() { this.revision++; this.trim(0); this.anchor = undefined; }
    dispose() { this.close(); }
}
