import { TFile } from "obsidian";

export const IMAGE_EXTENSIONS = new Set(["avif", "bmp", "gif", "jpeg", "jpg", "png", "svg", "webp"]);
const ENCRYPTED = new Set(["mdenc", "encrypted"]);
const PASSIVE = new Set(["zip", "7z", "rar", "tar", "gz", "mp3", "wav", "ogg", "m4a", "flac", "mp4", "webm", "mov", "woff", "woff2", "ttf", "otf"]);
const EXCLUDED = new Set([".obsidian", ".git", ".trash", "trash", "backup", "backups", ".backup", ".backups"]);
const TEXT = new Set(["md", "txt", "canvas", "excalidraw", "html", "htm", "xml", "icls", "css", "json"]);

export function isImageCandidate(file, configDir = ".obsidian") {
    const parts = file.path.split("/");
    return IMAGE_EXTENSIONS.has(file.extension.toLowerCase()) && parts.slice(0, -1).includes("assets")
        && !file.path.startsWith(`${configDir}/`)
        && !parts.slice(0, -1).some((part) => EXCLUDED.has(part.toLowerCase()) || part === configDir);
}

function resolveRelative(path, source) {
    const parts = path.startsWith("/") ? [] : source.split("/").slice(0, -1);
    for (const part of path.split("/")) {
        if (!part || part === ".") continue;
        if (part === "..") { if (!parts.length) return undefined; parts.pop(); }
        else parts.push(part);
    }
    return parts.join("/");
}

/** No mutation, decryption, plaintext index, or external image loading. */
export async function scanImageReferences(app, revision, cancelled = () => false) {
    const start = revision();
    const files = app.vault.getFiles();
    const candidates = files.filter((file) => isImageCandidate(file, app.vault.configDir));
    const referenced = new Set();
    const limitations = new Set();
    const paths = new Map(files.map((file) => [file.path, file]));
    const snapshots = new Map(files.map((file) => [file.path, `${file.stat.mtime}:${file.stat.size}`]));
    const open = new Map();
    const liveSnapshots = [];
    app.workspace.iterateAllLeaves(({ view }) => {
        if (!view.file) return;
        const views = open.get(view.file.path) ?? [];
        views.push(view);
        open.set(view.file.path, views);
    });
    const uncertain = (source, reason) => limitations.add(`${source}: ${reason}`);
    const protect = (raw, source, relative = false) => {
        if (typeof raw !== "string" || !raw.trim()) return;
        let path = raw.trim().replace(/^<|>$/g, "");
        if (/^(https?:|data:|mailto:|tel:|#)/i.test(path)) return;
        if (/^[a-z][\w+.-]*:/i.test(path) || path.startsWith("//")) {
            uncertain(source, "A non-vault URI cannot be checked safely."); return;
        }
        path = path.split("|")[0].split("#")[0].split("?")[0].replace(/\\([ ()[\]])/g, "$1");
        const variants = new Set([path]);
        try { variants.add(decodeURIComponent(path)); } catch { uncertain(source, "An invalid encoded link could not be resolved."); }
        let found = false;
        for (const value of variants) {
            const local = resolveRelative(value, source);
            const explicit = relative ? paths.get(local) ?? paths.get(value.replace(/^\//, "")) : paths.get(value.replace(/^\//, ""));
            const target = explicit ?? app.metadataCache.getFirstLinkpathDest(value, source);
            if (target instanceof TFile) { referenced.add(target.path); found = true; }
        }
        if (!found && /\.(avif|bmp|gif|jpe?g|png|svg|webp)$/i.test(path)) {
            // Unresolved image links may refer to ignored or ambiguous content.
            uncertain(source, "An image reference could not be resolved.");
        }
    };
    const markdown = async (text, source) => {
        if (/(?:%%🔐|🔐[αβγ]|🔐\s+[A-Za-z0-9+/]{16})/.test(text)) uncertain(source, "Encrypted inline content cannot be checked.");
        const metadata = await app.metadataCache.computeMetadataAsync(new TextEncoder().encode(text).buffer);
        if (!metadata) { uncertain(source, "Reference metadata could not be computed."); return; }
        for (const ref of [...(metadata.links ?? []), ...(metadata.embeds ?? []), ...(metadata.frontmatterLinks ?? [])]) {
            protect(ref.link, source, !ref.original?.includes("[["));
        }
        // Definitions and Excalidraw's hidden Embedded Files block are not all
        // present in native resolvedLinks. Protect even unused definitions.
        for (const match of text.matchAll(/!?\[\[([^\]\n]+)\]\]/g)) protect(match[1], source);
        for (const match of text.matchAll(/^\s{0,3}\[[^\]\n]+\]:\s*(?:<([^>\n]+)>|(\S+))/gm)) protect(match[1] ?? match[2], source, true);
        for (const match of text.matchAll(/\b(?:src|href|poster)\s*=\s*["']([^"']+)["']/gi)) protect(match[1], source, true);
        for (const match of text.matchAll(/\b(?:src|href|poster)\s*=\s*([^\s"'=<>`]+)/gi)) protect(match[1], source, true);
        for (const match of text.matchAll(/url\(\s*["']?([^)'"\n]+)["']?\s*\)/gi)) protect(match[1], source, true);
        // Conservatively protect image paths in scripts and configuration, too.
        for (const match of text.matchAll(/["'`]([^"'`\n]+\.(?:avif|bmp|gif|jpe?g|png|svg|webp)(?:[?#][^"'`\n]*)?)["'`]/gi)) protect(match[1], source, true);
        for (const match of text.matchAll(/^\s*[^:\n]+:\s*([^\n"']+\.(?:avif|bmp|gif|jpe?g|png|svg|webp))\s*$/gmi)) protect(match[1], source, true);
        if (/\bsrcset\s*=/i.test(text)) uncertain(source, "Responsive image source lists need manual review.");
    };
    const drawing = (scene, text, source) => {
        if (!scene || !Array.isArray(scene.elements)) { uncertain(source, "Unsupported Excalidraw scene."); return; }
        const mappings = new Map([...text.matchAll(/^([\w-]+):\s*(.+)$/gm)].map((match) => [match[1], match[2]]));
        for (const element of scene.elements) {
            if (element.link) protect(element.link, source);
            // Custom integrations may store references in formats we cannot infer.
            if (element.customData && Object.keys(element.customData).length) uncertain(source, "Excalidraw custom data needs manual review.");
            if (element.type !== "image" || element.isDeleted) continue;
            const id = element.fileId;
            const mapping = mappings.get(id);
            if (mapping && (/\[\[/.test(mapping) || /^https?:/i.test(mapping))) continue;
            const file = scene.files?.[id];
            if (file?.dataURL && /^(data:image\/|https?:)/i.test(file.dataURL)) continue;
            if (file?.path) { protect(file.path, source); continue; }
            uncertain(source, "An Excalidraw image mapping cannot be checked safely.");
        }
    };
    const canvas = async (data, source) => {
        if (!Array.isArray(data.nodes) || !Array.isArray(data.edges)) { uncertain(source, "Unsupported Canvas data."); return; }
        for (const node of data.nodes) {
            if (node.customData) uncertain(source, "Canvas custom data needs manual review.");
            if (node.type === "file") {
                if (typeof node.file !== "string" || !node.file) uncertain(source, "A Canvas file reference is invalid.");
                else protect(node.file, source);
            }
            else if (node.type === "text") await markdown(node.text ?? "", source);
            else if (node.type === "link") protect(node.url, source);
            else if (node.type !== "group") uncertain(source, "An unsupported Canvas node needs review.");
            if (node.background) protect(node.background, source);
        }
    };
    if (!app.metadataCache.initialized || !app.metadataCache.isCacheClean()) limitations.add("Reference indexing is still in progress. Scan again after indexing finishes.");
    for (const source of files) {
        if (cancelled()) throw new Error("Scan cancelled.");
        const ext = source.extension.toLowerCase();
        // Archives are historical containers, not active vault documents. Native
        // config/trash/version-control directories are not exposed by getFiles().
        if ((IMAGE_EXTENSIONS.has(ext) && ext !== "svg") || PASSIVE.has(ext)) continue;
        try {
            const contents = new Set();
            const views = open.get(source.path) ?? [];
            const readLive = (view, read) => {
                const text = read();
                contents.add(text);
                liveSnapshots.push({ view, file: view.file, read, text });
            };
            if (ENCRYPTED.has(ext)) {
                const unlocked = views.filter((view) => view.getViewType() === "meld-encrypted-view" && !view.isUnlocking && view.isSavingEnabled);
                if (!unlocked.length) {
                    uncertain(source.path, "Unlock this encrypted note before cleanup can be verified."); continue;
                }
                for (const view of unlocked) {
                    readLive(view, () => view.getUnencryptedViewData());
                    if (typeof view.cachedUnencryptedData === "string") contents.add(view.cachedUnencryptedData);
                }
            } else {
                if (!TEXT.has(ext) && ext !== "svg" && app.viewRegistry.typeByExtension[ext] !== "code-editor") {
                    uncertain(source.path, `Unsupported document format (.${ext}).`); continue;
                }
                if (source.stat.size > 20 * 1024 * 1024) { uncertain(source.path, "Document exceeds the safe scan size limit."); continue; }
                // Protect both saved and unsaved references, including duplicate tabs.
                contents.add(await app.vault.read(source));
                for (const view of views) {
                    if (view.getViewType() === "excalidraw") {
                        uncertain(source.path, "Save and close open drawings before cleanup."); continue;
                    }
                    if (ext === "canvas" && view.canvas?.getData) readLive(view, () => JSON.stringify(view.canvas.getData()));
                    else if (view.getViewData) readLive(view, () => view.getViewData());
                }
            }
            for (const text of contents) {
                if (typeof text !== "string" || text.includes("\0")) { uncertain(source.path, "Document is not readable text."); continue; }
                if (ext === "canvas") await canvas(JSON.parse(text), source.path);
                else if (ext === "excalidraw") drawing(JSON.parse(text), "", source.path);
                else {
                    await markdown(text, source.path);
                    if (/^excalidraw-plugin\s*:/m.test(text) || /\.excalidraw\.md$/i.test(source.path)) {
                        const block = /(?:^|\n)##? Drawing\s*\n[^`]*```(json|compressed-json)\s*\n([\s\S]*?)```/.exec(text);
                        if (!block) { uncertain(source.path, "Excalidraw drawing data is missing or unsupported."); continue; }
                        const decompress = app.workspace.containerEl.ownerDocument.defaultView.ExcalidrawAutomate?.decompressFromBase64;
                        const json = block[1] === "json" ? block[2] : decompress?.(block[2].replace(/\s+/g, ""));
                        if (!json) { uncertain(source.path, "Excalidraw decompression is unavailable."); continue; }
                        drawing(JSON.parse(json), text, source.path);
                    }
                }
            }
        } catch { uncertain(source.path, "Document could not be fully analyzed."); }
    }
    // Native resolved links supplement unsupported frontmatter/property syntax.
    for (const destinations of Object.values(app.metadataCache.resolvedLinks)) {
        for (const path of Object.keys(destinations)) referenced.add(path);
    }
    const changed = files.length !== app.vault.getFiles().length || files.some((file) => paths.get(file.path) !== app.vault.getAbstractFileByPath(file.path)
        || snapshots.get(file.path) !== `${file.stat.mtime}:${file.stat.size}`);
    const liveChanged = liveSnapshots.some(({ view, file, read, text }) => {
        try { return view.file !== file || read() !== text; } catch { return true; }
    });
    if (revision() !== start || changed || liveChanged) limitations.add("Vault content changed during the scan. Scan again before cleanup.");
    return {
        candidates: candidates.filter((file) => !referenced.has(file.path)).map((file) => ({ file, path: file.path, size: file.stat.size, mtime: file.stat.mtime })),
        limitations: [...limitations], referenced, revision: start,
    };
}
