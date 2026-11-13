import { isProtectedRemoteBranch } from "../utils/branch-protection";

export function protectedPushTarget(controller, repo, plan) {
    // Protection is stored per root; use an immutable context for other repositories.
    return isProtectedRemoteBranch({ repository: repo, plugin: controller.plugin }, `${plan.remote}/${plan.target}`, [plan.remote]);
}

export async function executePush(controller, repo, plan, options, signal) {
    await repo.assertNoOperation();
    if ((await repo.run(["rev-parse", "--verify", `${plan.sourceRef}^{commit}`], { signal })).trim() !== plan.source) {
        throw new Error("The source commit changed. Refresh the push preview.");
    }
    const snapshot = await repo.snapshot();
    if (!snapshot.remotes.includes(plan.remote)) throw new Error("The selected remote no longer exists.");
    const pushUrl = (await repo.run(["remote", "get-url", "--push", "--all", plan.remote], { signal })).trim();
    if (pushUrl !== plan.pushConfiguration || snapshot.current !== plan.checkedOut) throw new Error("The remote URL or checked-out branch changed. Refresh the push preview.");
    if (options.force && protectedPushTarget(controller, repo, plan)) throw new Error("Force Push is not allowed for this protected branch.");
    if (options.force && (!plan.verified || plan.needsFetch)) throw new Error("Fetch and review the remote commits before Force Push.");
    const args = ["push", "--porcelain", ...(options.force ? [`--force-with-lease=refs/heads/${plan.target}:${plan.tip || ""}`] : []),
        ...(options.tags === "all" ? ["--tags"] : options.tags === "follow" ? ["--follow-tags"] : []),
        ...(options.runHooks ? [] : ["--no-verify"]), "--", plan.multipleEndpoints ? plan.pushUrl : plan.remote, `${plan.source}:refs/heads/${plan.target}`];
    const result = await repo.run(args, { signal, returnResult: true, allowedExitCodes: [1, 128], timeout: 600000 });
    const refs = result.stdout.split(/\r?\n/).filter(line => /^[ =*+!\-]\t/.test(line)).map(line => {
        const [flag, spec, summary] = line.split("\t");
        return { flag, spec, summary, target: spec.slice(spec.indexOf(":") + 1), success: flag !== "!" };
    });
    const branch = refs.find(ref => ref.target === `refs/heads/${plan.target}`);
    let warning;
    if (branch?.success && options.setUpstream && plan.branch) {
        try {
            await repo.run(["config", `branch.${plan.branch}.remote`, plan.remote]);
            await repo.run(["config", `branch.${plan.branch}.merge`, `refs/heads/${plan.target}`]);
        } catch (error) { warning = `Push succeeded, but upstream configuration failed: ${error.message}`; }
    }
    const rejected = refs.filter(ref => !ref.success);
    const nonFastForward = rejected.some(ref => /non-fast-forward|fetch first/.test(ref.summary));
    return { success: result.code === 0 && !rejected.length, refs, nonFastForward, warning,
        message: [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n") || "Git returned no push details." };
}
