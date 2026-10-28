// Extensions already registered by Obsidian (do not register these)
const OBSIDIAN_EXTENSIONS = new Set(["md", "canvas", "pdf", "svg"]);

// Built-in supported extensions
export const TEXT_EXTENSIONS = [
	// Code
	"js", "ts", "jsx", "tsx", "py", "rb", "go", "rs", "java", "c", "cpp", "h",
	"cs", "php", "swift", "kt", "scala", "lua", "pl", "r", "m", "mm",
	"mjs", "cjs", "mts", "cts", "pyi", "cc", "cxx", "hpp", "hxx", "kts",
	// Config/Data
	"json", "yaml", "yml", "toml", "xml", "ini", "env", "conf",
	"csv", "tsv", "jsonc", "jsonl", "ndjson", "properties", "cfg", "proto", "cmake",
	// Web
	"html", "htm", "css", "scss", "sass", "less",
	"vue", "svelte", "http", "rest",
	// Shell/Scripts
	"sh", "bash", "zsh", "fish", "ps1", "bat", "cmd",
	"psm1", "psd1",
	// Other
	"sql", "graphql", "dockerfile", "makefile", "gitignore", "txt", "log",
];

// Map file extensions to highlight.js language identifiers
export function getLanguageFromExtension(ext: string): string {
	const langMap: Record<string, string> = {
		js: "javascript",
		mjs: "javascript",
		cjs: "javascript",
		ts: "typescript",
		mts: "typescript",
		cts: "typescript",
		jsx: "javascript",
		tsx: "typescript",
		py: "python",
		pyi: "python",
		rb: "ruby",
		rs: "rust",
		yml: "yaml",
		sh: "bash",
		zsh: "bash",
		fish: "bash",
		ps1: "powershell",
		psm1: "powershell",
		psd1: "powershell",
		bat: "dos",
		cmd: "dos",
		h: "c",
		hpp: "cpp",
		hxx: "cpp",
		cc: "cpp",
		cxx: "cpp",
		mm: "objectivec",
		m: "objectivec",
		kt: "kotlin",
		kts: "kotlin",
		jsonc: "json",
		jsonl: "json",
		ndjson: "json",
		properties: "properties",
		cfg: "ini",
		proto: "protobuf",
		vue: "xml",
		svelte: "xml",
		rest: "http",
		csv: "plaintext",
		tsv: "plaintext",
	};
	return langMap[ext.toLowerCase()] || ext.toLowerCase();
}

// Get all extensions (built-in + user-configured), excluding Obsidian-native extensions
export function getAllExtensions(additionalExtensions: string[]): string[] {
	const combined = new Set([...TEXT_EXTENSIONS, ...additionalExtensions]);
	return Array.from(combined).filter(
		(ext) => ext.trim().length > 0 && !OBSIDIAN_EXTENSIONS.has(ext.toLowerCase())
	);
}
