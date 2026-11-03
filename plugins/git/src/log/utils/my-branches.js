/** Match IDEA's exclusiveNodes rule: nonempty exclusive history, entirely by me. */
export async function readMyBranches(repository, signal) {
    const root = repository.root;
    const validate = () => {
        signal.throwIfAborted();
        if (repository.disposed || repository.root !== root) throw new Error("The repository changed. Retry Show My Branches.");
    };
    const run = async (args, options = {}) => {
        validate();
        const result = await repository.run(args, { ...options, signal });
        validate();
        return result;
    };
    const refsArgs = ["for-each-ref", "--format=%(refname)%09%(objectname)%09%(symref)"];
    const refsBefore = await run(refsArgs);
    const branches = refsBefore.trim().split(/\r?\n/).map(line => line.split("\t"))
        .filter(([ref, , symbolic]) => /^refs\/(heads|remotes)\//.test(ref) && !symbolic);
    if (!branches.length) return new Set();
    if ((await run(["rev-parse", "--is-shallow-repository"])).trim() === "true") {
        throw new Error("Show My Branches needs complete history. This repository is shallow.");
    }
    const email = (await run(["config", "--get", "user.email"], { allowedExitCodes: [1] })).trim();
    if (!email) throw new Error("Set user.email in Git settings before using Show My Branches.");
    const name = (await run(["config", "--get", "user.name"], { allowedExitCodes: [1] })).trim();
    const identity = (await run(["check-mailmap", `${name} <${email}>`])).trim();
    const canonicalEmail = (identity.match(/<([^<>]+)>$/)?.[1] || email).toLowerCase();
    const headBefore = await run(["rev-parse", "--verify", "HEAD"], { allowedExitCodes: [128] });
    const raw = await run(["-c", "log.showSignature=false", "log", "--branches", "--remotes", "--tags", ...(headBefore.trim() ? ["HEAD"] : []), "--topo-order", "--no-show-signature", "--format=%H%x09%P%x09%aE", "--"]);
    const heads = new Set(branches.map(([, hash]) => hash));
    const incoming = new Map();
    const mine = new Map();
    const seen = new Set();
    const shared = false;
    const lines = raw.trim().split(/\r?\n/);
    for (let index = 0; index < lines.length; index++) {
        if (index % 2048 === 0) {
            await new Promise(resolve => setTimeout(resolve, 0));
            validate();
        }
        const [hash, parents = "", author = ""] = lines[index].split("\t");
        if (!/^[a-f\d]{40,64}$/.test(hash)) throw new Error("Git returned incomplete history. Retry Show My Branches.");
        seen.add(hash);
        // A branch head with any outside child is not exclusive, even if tagged.
        const inherited = incoming.get(hash);
        const owner = heads.has(hash) ? inherited === undefined ? hash : shared : inherited ?? shared;
        if (owner) mine.set(owner, (mine.get(owner) ?? true) && author.toLowerCase() === canonicalEmail);
        for (const parent of parents.split(" ").filter(Boolean)) {
            const previous = incoming.get(parent);
            incoming.set(parent, previous === undefined ? owner : previous === owner ? owner : shared);
        }
    }
    if ([...incoming.keys()].some(hash => !seen.has(hash))) throw new Error("Git history is incomplete. Fetch the missing history before filtering branches.");
    if (refsBefore !== await run(refsArgs) || headBefore !== await run(["rev-parse", "--verify", "HEAD"], { allowedExitCodes: [128] })) {
        throw new Error("References changed while checking branches. Retry Show My Branches.");
    }
    return new Set(branches.filter(([, hash]) => mine.get(hash) === true).map(([ref]) => ref));
}
