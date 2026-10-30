import { ItemView } from "obsidian";
import { iconName } from "../../utils/icons";

export const DIFF_VIEW = "patchwork-git-diff";

/** A read-only diff snapshot in a workspace tab. */
export class DiffView extends ItemView {
    getViewType() { return DIFF_VIEW; }
    getDisplayText() { return this.title || "Git Diff"; }
    getIcon() { return iconName("git-show-diff"); }
    getState() { return { title: this.title, text: this.text }; }

    async setState(state, result) {
        this.title = state.title || "Git Diff";
        this.text = state.text || "No changes.";
        this.contentEl.empty();
        this.contentEl.classList.add("pw-git-diff-view");
        this.contentEl.createEl("pre", { cls: "pw-git-output", text: this.text });
        await super.setState(state, result);
    }
}
