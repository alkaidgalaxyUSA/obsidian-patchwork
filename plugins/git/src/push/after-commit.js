import { Notice } from "obsidian";
import { openGitDialog } from "../utils/portals";
import { GitPushModal } from "./push-modal";
import { defaultPushTarget, readPushPlan, fetchPushPlanObjects } from "./push-data";
import { executePush, protectedPushTarget } from "./push-operation";

/** Prepare silently when preview was explicitly disabled; failures always return to review. */
export async function pushAfterCommit(controller) {
    const repo = controller.repository, root = repo.root;
    const prefs = controller.plugin.settingsStore.preferences;
    if (prefs.previewCommitPush !== false) { openGitDialog(controller, new GitPushModal(controller)); return; }
    const request = new AbortController();
    let completed = false, failure;
    try {
        await controller.act(async () => {
            const destination = await defaultPushTarget(repo);
            let plan = await readPushPlan(repo, destination, request.signal);
            if (plan.verified && plan.needsFetch) {
                await fetchPushPlanObjects(repo, plan, request.signal);
                plan = await readPushPlan(repo, destination, request.signal);
            }
            if (!plan.verified || plan.needsFetch || plan.incoming || plan.multipleEndpoints || protectedPushTarget(controller, repo, plan)) return;
            const result = await executePush(controller, repo, plan, { tags: prefs.pushTags || "all", runHooks: true, setUpstream: !destination.tracking }, request.signal);
            completed = result.success && !result.warning;
            if (!completed) failure = result.warning || result.message;
        }, true, { title: "Git: Commit and Push", signal: request.signal, onCancel: () => request.abort() });
    } catch (error) {
        if (error.name === "AbortError") { new Notice("Push cancelled. Check remote status before retrying."); return; }
        failure = error.message;
    }
    if (controller.disposed || repo.root !== root) return;
    if (completed) { new Notice("Push successful."); return; }
    const modal = new GitPushModal(controller);
    openGitDialog(controller, modal);
    if (failure) modal.status.setText(failure);
}
