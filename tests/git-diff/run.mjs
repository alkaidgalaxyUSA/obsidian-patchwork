import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:http";
const directory = await mkdtemp(join(tmpdir(), "patchwork-diff-test-"));
await build({ entryPoints: ["tests/git-diff/unit.ts"], outfile: join(directory, "unit.cjs"), bundle: true, platform: "node", format: "cjs" });
const suite = await import(pathToFileURL(join(directory, "unit.cjs")).href);
await suite.default.integration;
if (!process.argv.includes("--browser")) process.exit(0);
await build({ entryPoints: ["tests/git-diff/browser.js"], outfile: join(directory, "browser.js"), bundle: true, platform: "browser", plugins: [{ name: "icons", setup(api) {
    api.onResolve({ filter: /utils\/icons$/ }, () => ({ path: "icons", namespace: "mock" }));
    api.onLoad({ filter: /.*/, namespace: "mock" }, () => ({ contents: "export function setIcon() {}" }));
} }] });
const css = (await Promise.all(["diff.css", "islands.css", "diff-documents.css"].map(file => readFile(resolve("plugins/git/styles", file), "utf8")))).join("\n");
await writeFile(join(directory, "styles.css"), css);
await writeFile(join(directory, "index.html"), `<!doctype html><html><head><meta charset="utf-8"><title>Patchwork Diff regression</title><link rel="stylesheet" href="styles.css"><style>
body {margin:20px;background:#191a1c;color:#ddd;--background-primary:#191a1c;--background-secondary:#24262a;--text-normal:#ddd;--text-faint:#888;--text-muted:#999;--text-accent:#70aeff;--background-modifier-border:#3d4045;--font-monospace:Consolas,monospace;--scrollbar-thumb-bg:#666;--font-text:Arial;}
#host {height:520px;width:1000px;} pre {font-size:13px;line-height:20px;margin:0;height:100%;} #results{white-space:pre-wrap;} button{padding:6px;margin:4px;}
</style></head><body class="theme-dark"><button id="split">Side by side</button><button id="unified">Unified</button><button id="wrap">Soft wraps</button><button id="align">Align blocks</button><button id="next">Next difference</button><button id="run">Run regression</button><div id="host" data-pw-module="git"></div><div id="results" role="status"></div><script src="browser.js"></script></body></html>`);
const server = createServer(async (request, response) => {
    const name = new URL(request.url, "http://localhost").pathname.slice(1) || "index.html";
    if (!["index.html", "browser.js", "styles.css"].includes(name)) { response.writeHead(404).end(); return; }
    response.setHeader("Content-Type", name.endsWith(".js") ? "text/javascript" : name.endsWith(".css") ? "text/css" : "text/html");
    response.end(await readFile(join(directory, name)));
});
server.listen(19431, "127.0.0.1", () => console.log("Browser regression: http://127.0.0.1:19431"));
