/* Pure logic behind attaching a file to the note it is inserted into: which
 * folder it belongs in, what it ends up called, and how it is written into the
 * note. No Obsidian imports, so it runs under Node for tests; main.ts supplies
 * the vault glue. Covered by tests.ts. */

/**
 * Where an inserted file is saved.
 *
 * "obsidian" is the app's own attachment setting, which is one folder for the
 * whole vault: a screenshot pasted into a meeting note and a contract attached
 * to it land in the same pile, and nothing in that pile says which note it
 * belongs to. "note" and "subfolder" keep a document with the page that talks
 * about it, so moving or archiving the page takes its papers along.
 */
export type FileLocation = "note" | "subfolder" | "obsidian";

/** The folder part of a vault path. "" for a note at the vault root, which is
 *  a real answer here and not a missing one: it is the root folder. */
export function folderOf(path: string): string {
	const at = path.lastIndexOf("/");
	return at < 0 ? "" : path.slice(0, at);
}

/** The file name part of a vault path, extension included. */
export function nameOf(path: string): string {
	const at = path.lastIndexOf("/");
	return at < 0 ? path : path.slice(at + 1);
}

/** Lower-case extension without the dot, "" when there is none. Only a dot
 *  with something before it counts, so ".gitignore" is a name, not a type. */
export function extOf(name: string): string {
	const base = nameOf(name);
	const at = base.lastIndexOf(".");
	return at > 0 ? base.slice(at + 1).toLowerCase() : "";
}

/** The name without its extension, for a title or a folder named after it. */
export function stemOf(name: string): string {
	const base = nameOf(name);
	const ext = extOf(base);
	return ext ? base.slice(0, base.length - ext.length - 1) : base;
}

/**
 * The folder a file inserted into `notePath` belongs in, or null to leave the
 * choice to Obsidian's own attachment setting.
 *
 * Null is also the answer when there is no note to sit beside, which happens
 * in a pane that is not backed by a file: "beside the note" has no meaning
 * there, and the app's setting always has an answer.
 */
export function attachmentFolder(notePath: string, mode: FileLocation, subfolder: string): string | null {
	if (mode === "obsidian" || !notePath) return null;
	const here = folderOf(notePath);
	if (mode === "note") return here;
	const sub = folderName(subfolder, stemOf(notePath));
	if (!sub) return here; // an empty subfolder name means beside the note
	return here ? `${here}/${sub}` : sub;
}

/**
 * A subfolder name, with `{note}` standing for the note's own name so each
 * page can keep its files in a folder of its own. Written as a path
 * ("Files/PDFs") it stays one, since nesting is a reasonable thing to ask for,
 * but every segment is cleaned the way a file name is.
 */
function folderName(pattern: string, noteStem: string): string {
	return pattern
		.replace(/\{note\}/gi, noteStem)
		.split("/")
		.map((seg) => safeFileName(seg, ""))
		.filter(Boolean)
		.join("/");
}

/**
 * A name the vault and the file system will both accept.
 *
 * These are the characters Windows refuses outright, plus the four Obsidian
 * reserves inside a link: `|` starts an alias, `#` a heading, `^` a block
 * reference, and `[]` close the link early. A file carrying one of those can
 * be written into a note and then never followed back. Leading and trailing
 * dots and spaces go for Windows' sake, which drops them silently and then
 * cannot find the file it just wrote.
 */
export function safeFileName(name: string, fallback: string): string {
	const cleaned = nameOf(name.replace(/\\/g, "/"))
		.replace(/[<>:"|?*#^[\]]/g, "-")
		.replace(/\s+/g, " ")
		.replace(/^[.\s]+/, "")
		.replace(/[.\s]+$/, "")
		.trim();
	return cleaned || fallback;
}

/**
 * The first free path for `name` in `folder`, asking `taken` about each
 * candidate: "Contract.pdf", then "Contract 1.pdf", and so on.
 *
 * Attaching the same file to two notes is normal (an invoice referenced from a
 * project page and again from the month's summary), and so is downloading a
 * second file whose name is generic. Neither may overwrite what is there.
 */
export function freePath(folder: string, name: string, taken: (path: string) => boolean): string {
	const join = (n: string) => (folder ? `${folder}/${n}` : n);
	if (!taken(join(name))) return join(name);
	const ext = extOf(name);
	const stem = stemOf(name);
	const suffix = ext ? `.${ext}` : "";
	for (let n = 1; n < 1000; n++) {
		const candidate = join(`${stem} ${n}${suffix}`);
		if (!taken(candidate)) return candidate;
	}
	// a thousand collisions is not a real vault, but a name is still owed
	return join(`${stem} ${new Date().toISOString().replace(/\D/g, "")}${suffix}`);
}

/**
 * How a PDF is written into a note.
 *
 * "link" is the default because an embedded PDF is a scrolling multi-page
 * viewer, and a note listing four attachments under a heading would be four
 * documents deep instead of four lines long. A link is one line, so the list
 * stays a list, and the document opens when it is actually wanted.
 */
export type PdfInsert = "link" | "embed";

/** Types Obsidian draws in the page itself. */
const EMBEDDABLE = new Set([
	"pdf",
	"md",
	"canvas",
	"png", "jpg", "jpeg", "gif", "bmp", "svg", "webp", "avif",
	"mp3", "wav", "m4a", "ogg", "3gp", "flac", "webm",
	"mp4", "mov", "mkv", "ogv",
]);

/** Pictures, which keep doing whatever Obsidian already does with them: a
 *  screenshot pasted into a note is not a document filed with it. */
const IMAGES = new Set(["png", "jpg", "jpeg", "gif", "bmp", "svg", "webp", "avif"]);

/** True when this file is written into the note as an embed rather than a
 *  link. A picture or a recording is its own content and belongs on the page;
 *  a PDF is a document, and that is the setting's call. */
export function isEmbeddable(name: string, pdf: PdfInsert): boolean {
	const ext = extOf(name);
	if (ext === "pdf") return pdf === "embed";
	return EMBEDDABLE.has(ext);
}

/** True for the picture types, by name or by the type the browser reports. */
export function isImageFile(name: string, mimeType = ""): boolean {
	return IMAGES.has(extOf(name)) || mimeType.startsWith("image/");
}

/**
 * A link Obsidian generated, turned into what this file should be in the note:
 * an embed for anything it can draw, a plain link for everything else.
 *
 * The link itself is left exactly as the app wrote it, wikilink or Markdown,
 * shortest path or relative, since that is the vault's own setting and not
 * ours to have an opinion about. Only the leading `!` is decided here. A
 * `.docx` written as an embed renders as an empty frame with nothing in it,
 * which reads as a broken link rather than as an attachment.
 */
export function attachmentMarkdown(link: string, name: string, pdf: PdfInsert): string {
	if (isEmbeddable(name, pdf)) return link.startsWith("!") ? link : "!" + link;
	return link.startsWith("!") ? link.slice(1) : link;
}

const FENCE_AT = /^\s*(```|~~~)/;
const PDF_WIKI_EMBED = /!(\[\[[^\]]*\.pdf[^\]]*\]\])/gi;
const PDF_MD_EMBED = /!(\[[^\]]*\]\([^)]*\.pdf[^)]*\))/gi;

/**
 * Turn PDF embeds already written into a note back into links, for the notes
 * that were written before the setting existed or under the other choice.
 *
 * Only the leading `!` goes, so an alias, a `#page=` subpath, and the link's
 * own form all survive. Fenced code is skipped: a note explaining the syntax
 * has embeds in it that are examples rather than attachments.
 */
export function unembedPdfs(text: string): { text: string; count: number } {
	let count = 0;
	let fenced = false;
	const drop = (line: string) =>
		line.replace(PDF_WIKI_EMBED, (_m, keep: string) => (count++, keep)).replace(PDF_MD_EMBED, (_m, keep: string) => (count++, keep));
	const out = text.split("\n").map((line) => {
		if (FENCE_AT.test(line)) {
			fenced = !fenced;
			return line;
		}
		return fenced ? line : drop(line);
	});
	return { text: out.join("\n"), count };
}
