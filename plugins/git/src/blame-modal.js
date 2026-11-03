import { GitTaskModal } from "./ui/task-modal";

/** Porcelain annotations, rendered as text with explicit revision navigation. */
export class GitBlameModal extends GitTaskModal {
    constructor(controller, path) { super(controller, `Annotate: ${path}`); this.path = path; }
    onOpen() {
        super.onOpen(); this.modalEl.classList.add("pw-git-blame-modal");
        this.list = this.body.createDiv({ cls: "pw-git-blame-list" });
        this.button("Refresh", () => this.load());
        void this.perform(() => this.load());
    }
    async load() {
        const raw = await this.repo.run(["blame", "--line-porcelain", "--", this.path]);
        this.validate(); this.list.empty();
        const rows = []; let current;
        for (const line of raw.split("\n")) {
            const header = /^([0-9a-f]{40,64}) (\d+) (\d+)(?: \d+)?$/.exec(line);
            if (header) { current = { hash: header[1], number: header[3] }; continue; }
            if (!current) continue;
            if (line.startsWith("author ")) current.author = line.slice(7);
            if (line.startsWith("summary ")) current.subject = line.slice(8);
            if (line.startsWith("\t")) { rows.push({ ...current, content: line.slice(1) }); current = undefined; }
        }
        let offset = 0;
        const append = () => {
            for (const entry of rows.slice(offset, offset + 1000)) {
                const row = this.list.createDiv({ cls: "pw-git-blame-row" });
                const button = row.createEl("button", { text: `${entry.hash.slice(0, 8)} ${entry.author}`, attr: { title: entry.subject || "", type: "button" } });
                button.disabled = /^0+$/.test(entry.hash);
                button.onclick = () => { try { this.validate(); this.controller.compare(entry.hash, "HEAD", [this.path]); } catch (error) { this.status.setText(error.message); } };
                row.createSpan({ text: entry.number, cls: "pw-diff-line-number" });
                row.createEl("code", { text: entry.content });
            }
            offset += 1000;
            more.hidden = offset >= rows.length;
        };
        const more = this.list.createEl("button", { text: "Show more lines", attr: { type: "button" } });
        more.onclick = () => { append(); this.list.append(more); };
        append(); this.list.append(more);
        this.status.setText(`${rows.length} annotated lines. Select an annotation to compare its commit with HEAD.`);
    }
}
