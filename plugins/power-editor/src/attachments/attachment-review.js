import { Modal } from "obsidian";

const sizeLabel = (bytes) => bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export class AttachmentReview extends Modal {
    constructor(manager) {
        super(manager.app);
        this.manager = manager;
        this.selected = new Set();
        this.scanToken = 0;
        this.closed = false;
    }

    onOpen() {
        this.setTitle("Review unreferenced images");
        this.modalEl.classList.add("pw-attachment-review");
        this.contentEl.createEl("p", { text: "Review candidates are not proof that an image is unwanted. Only selected images will be moved to the vault's recoverable .trash folder." });
        this.summary = this.contentEl.createDiv({ attr: { role: "status" } });
        this.warnings = this.contentEl.createDiv({ cls: "pw-attachment-warnings" });
        const actions = this.contentEl.createDiv({ cls: "pw-attachment-actions" });
        this.refresh = actions.createEl("button", { text: "Scan again" });
        this.refresh.addEventListener("click", () => void this.scan());
        this.selectAll = actions.createEl("button", { text: "Select all" });
        this.selectAll.addEventListener("click", () => { this.items.forEach((item) => this.selected.add(item)); this.syncSelection(); });
        this.clear = actions.createEl("button", { text: "Clear selection" });
        this.clear.addEventListener("click", () => { this.selected.clear(); this.syncSelection(); });
        this.remove = actions.createEl("button", { text: "Move selected to trash", cls: "mod-warning" });
        this.remove.addEventListener("click", () => this.confirm());
        this.selection = this.contentEl.createDiv({ attr: { role: "status" } });
        this.list = this.contentEl.createDiv({ cls: "pw-attachment-list" });
        void this.scan();
    }

    async scan() {
        if (this.scanning || this.manager.cleaning) return;
        this.scanning = true;
        const token = ++this.scanToken;
        this.selected.clear();
        this.items = [];
        this.boxes = new Map();
        this.list.empty();
        this.warnings.empty();
        this.blocked = true;
        this.summary.textContent = "Scanning references across the vault...";
        this.syncSelection();
        try {
            const result = await this.manager.scan(() => this.closed || token !== this.scanToken);
            if (this.closed || token !== this.scanToken) return;
            this.items = result.candidates.sort((a, b) => a.path.localeCompare(b.path));
            this.blocked = result.limitations.length > 0;
            this.summary.textContent = `${this.items.length} review candidates · ${sizeLabel(this.items.reduce((sum, item) => sum + item.size, 0))}`;
            if (this.blocked) {
                this.warnings.createEl("strong", { text: "Cleanup is blocked until all references can be checked." });
                const details = this.warnings.createEl("details");
                details.createEl("summary", { text: `${result.limitations.length} detection limitations` });
                const list = details.createEl("ul");
                result.limitations.forEach((reason) => list.createEl("li", { text: reason }));
            }
            this.cursor = 0;
            this.appendPage();
        } catch {
            if (!this.closed) this.summary.textContent = "Scan did not complete. No images were changed.";
        } finally {
            this.scanning = false;
            if (!this.closed) this.syncSelection();
        }
    }

    appendPage() {
        this.more?.remove();
        let group;
        let directory;
        const end = Math.min(this.items.length, this.cursor + 100);
        for (; this.cursor < end; this.cursor++) {
            const item = this.items[this.cursor];
            const parent = item.path.split("/").slice(0, -1).join("/");
            if (parent !== directory) {
                directory = parent;
                group = this.list.createEl("section");
                group.createEl("h3", { text: directory });
            }
            const row = group.createEl("label", { cls: "pw-attachment-row" });
            const box = row.createEl("input", { type: "checkbox", attr: { "aria-label": `Select ${item.path}` } });
            box.checked = this.selected.has(item);
            box.disabled = this.blocked;
            box.addEventListener("change", () => { if (box.checked) this.selected.add(item); else this.selected.delete(item); this.syncSelection(); });
            this.boxes.set(box, item);
            // SVG may contain remote resources. Do not load it automatically.
            if (item.file.extension.toLowerCase() === "svg") {
                const preview = row.createEl("button", { cls: "pw-attachment-thumbnail", text: "Preview SVG", type: "button", attr: { "aria-label": `Preview ${item.path}` } });
                preview.addEventListener("click", (event) => {
                    event.preventDefault();
                    this.close();
                    void this.app.workspace.getLeaf("tab").openFile(item.file);
                });
            }
            else row.createEl("img", { cls: "pw-attachment-thumbnail", attr: { src: this.app.vault.getResourcePath(item.file), loading: "lazy", alt: item.file.name } });
            const text = row.createDiv();
            text.createDiv({ text: item.file.name });
            text.createDiv({ cls: "pw-attachment-path", text: item.path });
            text.createDiv({ cls: "pw-attachment-path", text: sizeLabel(item.size) });
        }
        if (this.cursor < this.items.length) {
            this.more = this.list.createEl("button", { text: `Load more (${this.items.length - this.cursor} remaining)` });
            this.more.addEventListener("click", () => this.appendPage());
        }
    }

    syncSelection() {
        const disabled = this.scanning || this.manager.cleaning || this.blocked;
        this.refresh.disabled = this.scanning || this.manager.cleaning;
        this.selectAll.disabled = disabled || !this.items?.length;
        this.clear.disabled = this.manager.cleaning || !this.selected.size;
        this.remove.disabled = disabled || !this.selected.size;
        for (const [box, item] of this.boxes ?? []) { box.checked = this.selected.has(item); box.disabled = disabled; }
        this.selection.textContent = `${this.selected.size} selected · ${sizeLabel([...this.selected].reduce((sum, item) => sum + item.size, 0))}`;
    }

    confirm() {
        if (this.blocked || this.manager.cleaning || !this.selected.size || this.confirmation) return;
        const selected = [...this.selected];
        const modal = new Modal(this.app);
        this.confirmation = modal;
        modal.setTitle("Move images to trash?");
        modal.contentEl.createEl("p", { text: `${selected.length} selected images · ${sizeLabel(selected.reduce((sum, item) => sum + item.size, 0))}. References will be checked again before each image. Recover moved files from the vault's .trash folder.` });
        const controls = modal.contentEl.createDiv({ cls: "pw-attachment-actions" });
        controls.createEl("button", { text: "Cancel" }).addEventListener("click", () => modal.close());
        const confirm = controls.createEl("button", { text: "Move to trash", cls: "mod-warning" });
        confirm.addEventListener("click", async () => {
            if (confirm.disabled || this.closed || this.manager.cleaning) return;
            confirm.disabled = true;
            modal.close();
            const operation = this.manager.trash(selected, (message) => { if (!this.closed) this.summary.textContent = message; });
            this.syncSelection();
            const results = await operation;
            if (this.closed) return;
            this.selected.clear();
            this.blocked = true;
            this.list.empty();
            this.boxes.clear();
            for (const result of results) this.list.createEl("p", { text: `${result.state}: ${result.path} — ${result.reason}` });
            this.summary.textContent = "Cleanup finished. Scan again for fresh candidates.";
            this.syncSelection();
        });
        modal.onClose = () => { modal.contentEl.empty(); this.confirmation = undefined; };
        modal.open();
    }

    onClose() {
        this.closed = true;
        this.scanToken++;
        this.confirmation?.close();
        this.contentEl.querySelectorAll("img").forEach((image) => image.removeAttribute("src"));
        this.contentEl.empty();
        this.selected.clear();
        this.boxes?.clear();
        this.items = [];
        if (this.manager.review === this) this.manager.review = undefined;
    }
}
