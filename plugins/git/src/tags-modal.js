import { GitTaskModal } from "./ui/task-modal";
import { confirm } from "./dialogs";
import { refNameError } from "./utils/ref-name";

export class GitTagsModal extends GitTaskModal {
    constructor(controller) { super(controller, "Git Tags"); }
    onOpen() {
        super.onOpen();
        this.name = this.field("Tag name"); this.revision = this.field("Revision", "HEAD");
        const annotation = this.body.createEl("label", { cls: "pw-git-task-field" });
        annotation.createSpan({ text: "Annotation (optional)" });
        this.message = annotation.createEl("textarea", { attr: { rows: "4", "aria-label": "Annotation (optional)", spellcheck: "false" } });
        this.controls.push(this.message);
        const force = this.body.createEl("label", { cls: "pw-git-amend" });
        this.force = force.createEl("input", { attr: { type: "checkbox" } });
        force.createSpan({ text: "Force replace existing tag" });
        this.controls.push(this.force);
        this.force.onchange = () => this.updateActions();
        this.remote = this.field("Push remote", "", []);
        this.createButton = this.button("Create Tag", async () => {
            const name = this.name.value.trim(), message = this.message.value.trim();
            const previous = this.existingTags?.get(name);
            const force = this.force.checked && !!previous;
            if (previous && !force) throw new Error("A tag with this name already exists.");
            if (force && !await confirm(this.controller, "Replace local tag", `Replace ${name} with the selected revision and annotation? The previous local tag will be overwritten. Remote tags are unchanged.`, "Replace Tag")) return;
            await this.change(async () => {
                if (!name || name.startsWith("-")) throw new Error("Enter a valid tag name.");
                await this.repo.run(["check-ref-format", `refs/tags/${name}`]);
                const revision = (await this.repo.run(["rev-parse", "--verify", "--end-of-options", `${this.revision.value.trim()}^{commit}`])).trim();
                const current = (await this.repo.run(["rev-parse", "--verify", "--quiet", `refs/tags/${name}`], { allowedExitCodes: [1] })).trim();
                if (current !== (previous || "")) throw new Error("This tag changed. Refresh the list before creating or replacing it.");
                await this.repo.run(["tag", ...(force ? ["--force"] : []), ...(message ? ["-a", "-m", message] : []), "--", name, revision]);
            }); await this.load();
        }, true);
        this.name.oninput = () => { this.force.checked = false; this.updateActions(); };
        this.revision.oninput = this.remote.onchange = () => this.updateActions();
        this.updateActions();
        this.button("Refresh", () => this.load()); this.list = this.body.createDiv({ cls: "pw-git-manager-list" });
        void this.perform(() => this.load());
    }
    updateActions() {
        const name = this.name.value.trim();
        const exists = this.existingTags?.has(name);
        if (!exists) this.force.checked = false;
        this.force.disabled = this.pending || !exists;
        this.force.title = exists ? "Allow replacing this existing local tag after confirmation." : "Only available when the tag already exists.";
        const reason = refNameError(name) || (!this.revision.value.trim() ? "Enter a revision." : "")
            || (!this.existingTags ? "Refresh tags before creating a tag." : exists && !this.force.checked ? "A tag with this name already exists. Select Force to replace it." : "");
        this.createButton.disabled = this.pending || !!reason;
        this.createButton.title = reason;
        this.createButton.textContent = exists && this.force.checked ? "Replace Tag…" : "Create Tag";
        for (const button of this.remoteButtons || []) {
            button.disabled = this.pending || !this.remote.value;
            button.title = this.remote.value ? "" : "Configure and select a remote first.";
        }
    }
    async load() {
        const [raw, snapshot] = await Promise.all([this.repo.run(["for-each-ref", "--format=%(refname:strip=2)%09%(objectname)", "refs/tags"]), this.repo.snapshot()]);
        this.validate(); this.list.empty(); const selected = this.remote.value; this.remote.empty();
        this.remoteButtons = [];
        this.existingTags = new Map();
        this.force.checked = false;
        for (const name of snapshot.remotes) this.remote.createEl("option", { value: name, text: name });
        if (snapshot.remotes.includes(selected)) this.remote.value = selected;
        for (const line of raw.trim().split("\n").filter(Boolean)) {
            const [name, hash] = line.trim().split("\t"); const ref = `refs/tags/${name}`;
            this.existingTags.set(name, hash);
            const validate = async () => { if ((await this.repo.run(["rev-parse", "--verify", ref])).trim() !== hash) throw new Error("This tag changed. Refresh the list."); };
            const row = this.list.createDiv({ cls: "pw-git-manager-row" }); row.createSpan({ text: name });
            this.button("Compare", () => { this.controller.compare(ref); this.status.setText("Comparison opened."); }, false, row);
            const push = this.button("Push…", async () => {
                const remote = this.remote.value;
                if (!(await this.repo.snapshot()).remotes.includes(remote)) throw new Error("Select a remote.");
                if (!await confirm(this.controller, "Push tag", `Push ${name} to ${remote}?`, "Push")) return;
                await this.change(async () => { await validate(); await this.repo.run(["push", "--", remote, `${hash}:${ref}`]); }); this.status.setText("Tag pushed.");
            }, false, row);
            const checkout = this.button("Check Out…", async () => {
                if (!await confirm(this.controller, "Check out tag", `Check out ${name} as detached HEAD? Create a branch before adding commits.`, "Check Out")) return;
                await this.change(async () => { await this.repo.assertNoOperation(); await validate(); await this.repo.run(["switch", "--detach", hash]); }); this.status.setText("Tag checked out as detached HEAD.");
            }, false, row);
            const deleteRemote = this.button("Delete Remote…", async () => {
                const remote = this.remote.value;
                if (!(await this.repo.snapshot()).remotes.includes(remote)) throw new Error("Select a remote.");
                const listing = await this.repo.run(["ls-remote", "--refs", "--", remote, ref]);
                const tip = listing.split(/\r?\n/).find(line => line.split("\t")[1] === ref)?.split("\t")[0];
                if (!tip) throw new Error("This tag does not exist on that remote.");
                if (!await confirm(this.controller, "Delete remote tag", `Delete ${name} from ${remote}? Other users may depend on this tag.`, "Delete Remote")) return;
                await this.change(() => this.repo.run(["push", `--force-with-lease=${ref}:${tip}`, "--", remote, `:${ref}`])); this.status.setText("Remote tag deleted; local tag retained.");
            }, false, row);
            checkout.disabled = !!this.controller.operation;
            checkout.title = checkout.disabled ? "Finish or abort the active Git operation first." : "";
            this.remoteButtons.push(push, deleteRemote);
            this.button("Delete Local…", async () => {
                if (!await confirm(this.controller, "Delete local tag", `Delete local tag ${name}? Remote tags are unchanged.`, "Delete")) return;
                await this.change(async () => { await validate(); await this.repo.run(["update-ref", "-d", ref, hash]); }); await this.load();
            }, false, row);
        }
        this.status.setText(`${this.list.childElementCount} tags`);
    }
}
