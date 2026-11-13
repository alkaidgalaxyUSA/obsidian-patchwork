import { GitTaskModal } from "../ui/task-modal";
import { openGitDialog } from "../utils/portals";
import { prompt } from "../dialogs";

export function editPushTarget(controller, model) {
    return new Promise(resolve => openGitDialog(controller, new PushTargetModal(controller, model, resolve)));
}

/** Target editing is a transaction: cancel never changes the previewed destination. */
export class PushTargetModal extends GitTaskModal {
    constructor(controller, model, finish) { super(controller, "Push Target"); this.model = model; this.finish = finish; }
    onOpen() {
        super.onOpen();
        this.modalEl.classList.add("pw-git-push-target-modal");
        this.remote = this.field("Remote", "", []);
        this.endpoint = this.field("Push destination", "", []);
        this.branch = this.field("Branch", this.model.destination.target);
        this.completions = this.body.createEl("datalist", { attr: { id: `pw-push-target-${crypto.randomUUID()}` } });
        this.branch.setAttribute("list", this.completions.id);
        const label = this.body.createEl("label");
        this.track = label.createEl("input", { type: "checkbox" }); this.track.checked = this.model.setUpstream;
        this.track.disabled = !this.model.destination.branch;
        label.createSpan({ text: "Set as upstream" }); this.controls.push(this.track);
        this.remote.onchange = () => void this.perform(() => this.populate());
        this.button("Define Remote…", async () => {
            const name = await prompt(this.controller, "Define Remote", "Name", "origin"); if (!name) return;
            const url = await prompt(this.controller, "Define Remote", "URL"); if (!url) return;
            await this.change(() => this.model.repo.run(["remote", "add", "--", name, url]), "Add Remote");
            await this.load(name);
        });
        this.apply = this.button("OK", async () => {
            const target = this.branch.value.trim(), remote = this.remote.value;
            if (!this.snapshot.remotes.includes(remote)) throw new Error("Select a remote.");
            await this.model.repo.run(["check-ref-format", `refs/heads/${target}`]);
            this.validate(); this.finish({ remote, target, setUpstream: this.track.checked, pushEndpoint: this.endpoint.value,
                endpointCount: this.endpoint.options.length, endpointIndex: this.endpoint.selectedIndex }); this.close();
        }, true);
        this.branch.oninput = () => this.updateActions();
        this.branch.onkeydown = event => { if (event.key === "Enter" && !this.apply.disabled) { event.preventDefault(); this.apply.click(); } };
        void this.perform(() => this.load(this.model.destination.remote)).then(() => { if (!this.closed) { this.branch.focus(); this.branch.select(); } });
    }
    async load(selected) {
        this.snapshot = await this.model.repo.snapshot(); this.validate();
        this.remote.empty();
        for (const remote of this.snapshot.remotes) this.remote.createEl("option", { value: remote, text: remote });
        this.remote.value = this.snapshot.remotes.includes(selected) ? selected : this.snapshot.remotes[0] || "";
        await this.populate(); this.branch.focus(); this.branch.select();
    }
    async populate() {
        this.completions.empty();
        const prefix = `${this.remote.value}/`;
        for (const ref of this.snapshot.remote.filter(ref => ref.startsWith(prefix))) this.completions.createEl("option", { value: ref.slice(prefix.length) });
        this.endpoint.empty();
        if (this.remote.value) {
            const urls = (await this.model.repo.run(["remote", "get-url", "--push", "--all", this.remote.value])).trim().split(/\r?\n/);
            this.validate();
            urls.forEach((url, index) => {
                let label = url;
                try { const parsed = new URL(url); parsed.username = ""; parsed.password = ""; parsed.search = ""; label = parsed.toString(); } catch {}
                this.endpoint.createEl("option", { value: url, text: `${index + 1}: ${label}` });
            });
            this.endpoint.value = urls.includes(this.model.destination.pushEndpoint) ? this.model.destination.pushEndpoint : urls[0];
        }
        this.endpoint.closest("label").hidden = this.endpoint.options.length < 2;
        this.updateActions();
    }
    updateActions() { if (this.apply) this.apply.disabled = this.pending || !this.remote.value || !this.branch.value.trim(); }
    onClose() { this.finish(undefined); super.onClose(); }
}
