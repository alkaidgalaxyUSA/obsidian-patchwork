import { GitTaskModal } from "../ui/task-modal";
import { setIcon } from "../utils/icons";
import { fileIcon } from "../utils/file-icons";

/** Edit a draft selection; cancelling never changes the Log filter. */
export class GitPathsModal extends GitTaskModal {
    constructor(pane, tree = false) {
        super(pane.controller, "Select Paths to Filter by");
        this.pane = pane;
        this.document = pane.el.ownerDocument;
        this.tree = tree;
        this.selected = new Set(pane.filter.paths);
        this.modalEl.classList.add("pw-git-paths-modal");
        if (tree) this.treeEl = this.body.createDiv({ cls: "pw-git-paths-tree" });
        else {
            this.body.createEl("p", { text: "One repository-relative path per line. Use a trailing / for folders. Deleted paths are allowed. An empty list shows all paths." });
            this.input = this.body.createEl("textarea", { attr: { "aria-label": "Paths", rows: "10", spellcheck: "false" } });
            this.input.value = [...this.selected].join("\n");
        }
        this.button("Apply", async () => {
            if (this.pane.disposed || !this.pane.el.isConnected) throw new Error("The Git Log was closed.");
            const paths = this.tree ? [...this.selected] : this.input.value.split(/\r?\n/).filter(path => path.trim());
            if (paths.some(path => /^(?:[A-Za-z]:|[/\\])/.test(path) || path.split(/[\\/]/).includes("..") || path.includes("\0"))) {
                throw new Error("Use paths inside this repository without '..'.");
            }
            await this.pane.setPaths(paths.includes(".") ? [] : paths.map(path => path.replace(/\\/g, "/").replace(/^\.\//, "")));
            this.close();
        }, true);
    }

    onOpen() {
        super.onOpen();
        if (this.modalEl.ownerDocument !== this.document) { this.close(); return; }
        if (this.tree) void this.perform(() => this.loadTree());
        else this.input.focus();
    }

    async loadTree() {
        const raw = await this.repo.run(["ls-files", "-z"]);
        this.validate();
        const paths = [...new Set([...raw.split("\0").filter(Boolean), ...this.selected])].sort();
        const rootBody = this.treeEl;
        const folders = new Map([["", rootBody]]);
        const choice = (parent, path, label) => {
            const row = parent.createEl("label");
            const input = row.createEl("input", { attr: { type: "checkbox" } });
            input.checked = this.selected.has(path);
            input.onchange = () => { if (input.checked) this.selected.add(path); else this.selected.delete(path); };
            setIcon(row.createSpan({ cls: "pw-git-paths-icon", attr: { "aria-hidden": "true" } }), path.endsWith("/") ? "folder" : fileIcon(path));
            row.createSpan({ text: label });
        };
        for (const path of paths) {
            if (path === ".") continue;
            const parts = path.split("/");
            let prefix = "", parent = rootBody;
            for (const part of parts.slice(0, -1)) {
                prefix += part + "/";
                if (!folders.has(prefix)) {
                    const details = parent.createEl("details");
                    choice(details.createEl("summary"), prefix, part + "/");
                    folders.set(prefix, details.createDiv());
                }
                parent = folders.get(prefix);
            }
            if (parts.at(-1)) choice(parent, path, parts.at(-1));
        }
    }
}
