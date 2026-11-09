import { setIcon } from "../utils/icons";

/** Render counts only when their comparison target is known. */
export function renderBranchSync(host, state) {
    const signature = JSON.stringify(state ?? null);
    if (host.dataset.syncState === signature) return;
    host.dataset.syncState = signature;
    host.replaceChildren();
    const compared = state?.status === "compared";
    const outgoing = compared && state.ahead > 0;
    const incoming = compared && state.behind > 0;
    const publish = state?.status === "unpublished";
    host.hidden = !outgoing && !incoming && !publish;
    host.title = compared
        ? `${state.ahead} outgoing, ${state.behind} incoming compared with ${state.comparison} (last fetched refs).${state.tracking ? "" : " No upstream configured; comparing the unique same-name remote branch."}${outgoing && incoming ? " Branches have diverged; review before pushing." : ""}`
        : publish ? "No upstream or same-name remote branch. Publish this branch using Push…" : "Branch comparison unavailable.";
    host.setAttribute("aria-label", host.title);
    const indicator = (icon, count, direction) => {
        const item = host.createSpan({ cls: `pw-git-sync-${direction}` });
        setIcon(item.createSpan({ attr: { "aria-hidden": "true" } }), icon);
        if (count !== undefined) item.createSpan({ text: String(count) });
    };
    if (outgoing || publish) indicator("arrow-up-right", publish ? undefined : state.ahead, "outgoing");
    if (incoming) indicator("arrow-down-left", state.behind, "incoming");
}
