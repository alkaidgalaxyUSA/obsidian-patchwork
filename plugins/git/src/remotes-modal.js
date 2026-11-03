import { Modal } from "obsidian";
import { getWindowContext, resolveWindow } from "../../utils/windows";
import { confirm, prompt } from "./dialogs";
import { setIcon } from "./utils/icons";

/** Manage repository remotes without holding the Git operation lock while browsing. */
export class GitRemotesModal extends Modal {
    constructor(controller) {
        super(controller.app);
        this.controller = controller;
        this.repository = controller.repository;
        this.root = this.repository.root;
        this.rows = [];
        this.pending = false;
    }

    onOpen() {
        this.context = getWindowContext(this.modalEl.ownerDocument);
        this.setTitle("Git Remotes");
        this.modalEl.classList.add("pw-git-remotes-modal");
        const panel = this.contentEl.createDiv({ cls: "pw-git-remotes-panel" });
        const toolbar = panel.createDiv({ cls: "pw-git-remotes-toolbar", attr: { role: "toolbar", "aria-label": "Remote actions" } });
        this.addButton = this.button(toolbar, "Add Remote", "plus", () => this.edit());
        this.removeButton = this.button(toolbar, "Remove Remote", "minus", () => this.remove());
        this.editButton = this.button(toolbar, "Edit Remote", "idea/expui/general/edit_dark.svg", () => this.edit(this.selected));
        const table = panel.createEl("table", { cls: "pw-git-remotes-table" });
        const heading = table.createEl("thead").createEl("tr");
        heading.createEl("th", { text: "Name", attr: { scope: "col" } });
        heading.createEl("th", { text: "URL", attr: { scope: "col" } });
        this.body = table.createEl("tbody");
        this.status = this.contentEl.createDiv({ cls: "pw-git-remotes-status", attr: { role: "status" } });
        this.contentEl.createDiv({ cls: "modal-button-container" }).createEl("button", { text: "OK", cls: "mod-cta" }).onclick = () => this.close();
        void this.load();
    }

    button(parent, label, icon, action) {
        const button = parent.createEl("button", { cls: "clickable-icon", attr: { type: "button", "aria-label": label } });
        setIcon(button, icon);
        button.onclick = () => void this.perform(action);
        return button;
    }

    validate() {
        if (this.closed || this.controller.disposed || this.repository.root !== this.root
            || resolveWindow(this.context.windowId)?.document !== this.context.document) throw new Error("The remote manager or repository was closed or changed.");
    }

    async perform(action) {
        if (this.pending || this.closed) return;
        this.pending = true; this.updateButtons();
        try { this.validate(); await action(); }
        catch (error) { if (!this.closed) this.status.setText(error.message ?? "Could not update remotes."); }
        finally { this.pending = false; if (!this.closed) this.updateButtons(); }
    }

    async load() {
        await this.perform(async () => {
            this.status.setText("Loading remotes…");
            await this.read();
        });
    }

    async read() {
        const names = (await this.repository.run(["remote"])).trim().split("\n").filter(Boolean);
        this.validate();
        const rows = await Promise.all(names.map(async name => ({ name, url: (await this.repository.run(["remote", "get-url", "--", name])).trim() })));
        this.validate();
        this.rows = rows;
        this.selected = rows.find(row => row.name === this.selected?.name);
        this.body.empty();
        for (const remote of rows) {
            const row = this.body.createEl("tr", { attr: { tabindex: "0", "aria-selected": String(remote === this.selected) } });
            row.createEl("td", { text: remote.name });
            row.createEl("td", { text: remote.url });
            const select = () => {
                this.selected = remote;
                for (const item of this.body.children) item.setAttribute("aria-selected", String(item === row));
                this.updateButtons();
            };
            row.onclick = select;
            row.ondblclick = () => { select(); void this.perform(() => this.edit(remote)); };
            row.onkeydown = event => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault(); select();
                if (event.key === "Enter") void this.perform(() => this.edit(remote));
            };
        }
        this.status.setText(rows.length ? "" : "No remotes configured.");
    }

    updateButtons() {
        this.addButton.disabled = this.pending;
        this.editButton.disabled = this.pending || !this.selected;
        this.removeButton.disabled = this.pending || !this.selected;
    }

    async edit(remote) {
        const name = remote?.name ?? await prompt(this.controller, "Add Remote", "Name", "origin");
        if (!name) return;
        this.validate();
        if (name.startsWith("-") || /[\s\x00-\x1f]/.test(name)) throw new Error("Enter a valid remote name.");
        const url = await prompt(this.controller, remote ? "Edit Remote" : "Add Remote", "URL", remote?.url ?? "");
        if (!url) return;
        this.validate();
        await this.change(remote ? ["remote", "set-url", "--", name, url] : ["remote", "add", "--", name, url]);
    }

    async remove() {
        const remote = this.selected;
        if (!remote || !await confirm(this.controller, "Remove Remote", `Remove remote "${remote.name}"?`, "Remove")) return;
        this.validate();
        await this.change(["remote", "remove", "--", remote.name]);
    }

    async change(args) {
        if (this.controller.busy) throw new Error("Git is busy. Try again after the current operation finishes.");
        let succeeded = false;
        await this.controller.act(async () => {
            this.validate();
            await this.repository.run(args);
            succeeded = true;
        });
        if (this.closed) return;
        this.validate();
        await this.read();
        if (!succeeded) this.status.setText("The remote could not be updated. Check the Git error notification.");
    }

    onClose() { this.closed = true; }
}
