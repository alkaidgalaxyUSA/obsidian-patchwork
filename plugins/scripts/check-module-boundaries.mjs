import { readFile, readdir, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { mapCssRules, splitSelectors } from "./css-rules.mjs";
import { resolvePluginSource } from "./source-paths.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const project = resolve(root, "..");
const config = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8"));
const definitions = await Promise.all(Object.entries(config.plugins).map(async ([name, definition]) =>
  ({ name, ...await resolvePluginSource(root, definition) })));
definitions.sort((a, b) => b.source.length - a.source.length);
const within = (parent, file) => { const child = relative(parent, file); return !isAbsolute(child) && child !== ".." && !child.startsWith(`..${sep}`); };
const owner = file => definitions.find(definition => within(definition.source, file))?.name;
const moduleOwner = name => name === "code-editor" ? "content" : name;
const display = file => relative(project, file).split(sep).join("/");
const failures = [];
const fail = (file, message) => failures.push(`${display(file)}: ${message}`);
async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const results = await Promise.all(entries.filter(entry => !["node_modules", "dist", ".git"].includes(entry.name)).map(async entry => {
    const file = resolve(directory, entry.name);
    if (entry.isSymbolicLink()) { fail(file, "Linked source paths are forbidden."); return []; }
    if (entry.isDirectory()) return walk(file);
    return /\.(?:[cm]?js|ts|css|scss)$/.test(entry.name) ? [file] : [];
  }));
  return results.flat();
}
async function resolveReference(file, specifier) {
  const base = resolve(dirname(file), specifier.split(/[?#]/)[0]);
  for (const suffix of ["", ".ts", ".js", ".mjs", ".d.ts", ".json", "/index.ts", "/index.js"]) {
    try { return await realpath(base + suffix); } catch { /* Try the next source extension. */ }
  }
  fail(file, `Unresolved relative reference: ${specifier}`);
}

// Borders is the named native shell adapter. These files may select native
// wrappers, rails, resize handles and titlebars, but never feature interiors.
const shellStyles = new Set([
  "layout/shell.css", "layout/workspace-cards.css", "layout/native-resize.css", "layout/native-toggles.css",
  "top/styles.css", "left/styles.css", "left/left-ribbon-states.css", "left/icon-alignment.css", "right/styles.css", "bottom/styles.css", "bottom/background-progress.css",
].map(file => `plugins/borders/src/${file}`));
const files = [...await walk(root), ...await walk(resolve(project, "themes/Patchwork/src"))];
let imports = 0, selectors = 0;
for (const file of files) {
  const name = owner(file);
  const source = await readFile(file, "utf8");
  const style = /\.s?css$/.test(file);
  const theme = within(resolve(project, "themes"), file);
  const shared = within(resolve(root, "utils"), file);
  const contract = within(resolve(root, "contracts"), file);
  const references = style
    ? [...source.matchAll(/@(?:import|use|forward)\s*["']([^"']+)["']|url\(\s*["']?(\.[^"'\s;)]+)/g)]
      .map(match => match[1] ?? match[2]).filter(specifier => !/^(?:https?:|data:|sass:)/.test(specifier))
    : [...source.matchAll(/(?:\bfrom\s*|\bimport\(\s*|\brequire\(\s*|^import\s*)["'](\.[^"']+)["']/gm)].map(match => match[1]);
  for (const specifier of references) {
    imports++;
    const target = await resolveReference(file, specifier);
    if (!target) continue;
    const targetOwner = owner(target);
    if (name && targetOwner && targetOwner !== name) fail(file, `Sibling implementation reference: ${specifier}`);
    if ((shared || contract || theme) && targetOwner) fail(file, `Shared/default source imports a feature: ${specifier}`);
    if (contract && !within(resolve(root, "contracts"), target)) fail(file, `Contract imports executable infrastructure: ${specifier}`);
  }
  if (name && /(?:content\/src\/integrations\/legacy-panels|editor\/tools\/(?:bottom-tools|git-tool|terminal-tool)|power-editor\/src|claudian-extension\/src)/.test(source)) {
    fail(file, "Removed legacy implementation path.");
  }
  // Direct installed Patchwork plugin lookups are forbidden even in adapters.
  if (name && /(?:plugins\s*(?:\?\.)?\s*\[\s*["'](?:patchwork-(?:power-editor|borders|project|git|terminal)|claudian-extension|code-editor)["']|getPlugin\(\s*["'](?:patchwork-[^"']+|claudian-extension|code-editor)["'])/.test(source)) {
    fail(file, "Direct sibling plugin instance lookup; use a public service.");
  }
  if (!style) continue;
  mapCssRules(source, ({ selector }) => {
    for (const branch of splitSelectors(selector)) {
      selectors++;
      if (name === "borders") {
        if (!shellStyles.has(display(file))) fail(file, "Native shell CSS requires a named adapter disposition.");
        if (/\.(?:claudian-(?:container|messages|input|code|composer)|pw-git-(?:commit-panel|log-pane|popup|diff-view)|pw-powershell-session|cm-editor|markdown-rendered|ped-toolbar)\b/.test(branch)) {
          fail(file, `Shell reaches a feature interior: ${branch}`);
        }
        if (/\b(?:button|svg)\b/.test(branch) && !/\.(?:pw-|titlebar-|workspace-)/.test(branch)) fail(file, `Unbounded shell control selector: ${branch}`);
      } else if (name && !branch.includes(`[data-pw-module="${moduleOwner(name)}"]`)) {
        fail(file, `Unowned feature selector: ${branch}`);
      } else if (name) {
        const local = `[data-pw-module="${moduleOwner(name)}"]`;
        if (!branch.includes(`${local} [data-pw-module]:not(${local})`)) {
          fail(file, `Feature selector does not exclude nested foreign module roots: ${branch}`);
        }
      }
      if (theme && /\.(?:claudian-|ped-|pw-(?:git|code|document|explorer|terminal|note)-)/.test(branch)) fail(file, `Theme contains a feature selector: ${branch}`);
    }
  });
}
if (failures.length) throw new Error(`Module boundaries failed:\n${[...new Set(failures)].join("\n")}`);
console.log(`Module boundaries passed: ${definitions.length} targets, ${files.length} sources, ${imports} relative references, ${selectors} selectors.`);
