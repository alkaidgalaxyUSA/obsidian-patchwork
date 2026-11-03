import { build } from "esbuild";
import { builtinModules } from "node:module";
import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { resolvePluginSource } from "./source-paths.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const projectRoot = resolve(root, "..");
const iconRoot = resolve(root, "../icons");
const iconAssets = {};
for (const file of (await readdir(iconRoot)).sort()) {
  if (!/^(action-|code-)[a-z0-9-]+\.svg$/.test(file)) continue;
  const key = file.replace(/^action-/, "").replace(/\.svg$/, "");
  if (key in iconAssets) throw new Error(`Duplicate icon key: ${key}`);
  iconAssets[key] = await readFile(join(iconRoot, file), "utf8");
}
iconAssets["idea/expui/general/inspections/inspectionsEye_dark.svg"] = await readFile(join(iconRoot, "idea/expui/general/inspections/inspectionsEye_dark.svg"), "utf8");
iconAssets["idea/expui/general/edit_dark.svg"] = await readFile(join(iconRoot, "idea/expui/general/edit_dark.svg"), "utf8");
iconAssets["idea/expui/fileTypes/ignored_dark.svg"] = await readFile(join(iconRoot, "idea/expui/fileTypes/ignored_dark.svg"), "utf8");
for (const file of [
  "idea-expui-vcs-push_dark.svg", "idea-expui-vcs-merge_dark.svg",
  "idea-expui-vcs-changelist_dark.svg", "idea-vcs-branchNode.svg",
  "idea/expui/general/remove_dark.svg", "idea/general/gearPlain_dark.svg",
  "idea/expui/general/moveUp_dark.svg", "idea/expui/general/moveDown_dark.svg",
  "idea/dvcs/currentBranchLabel_dark.svg", "idea/dvcs/currentBranchFavoriteLabel_dark.svg", "idea/dvcs/branchLabel_dark.svg",
  "idea/expui/nodes/star_dark.svg", "idea/expui/toolwindows/commit_dark.svg", "idea/expui/toolwindows/vcs_dark.svg",
]) {
  iconAssets[file] = await readFile(join(iconRoot, file), "utf8");
}
const iconPlugin = {
  name: "patchwork-icons",
  setup(build) {
    build.onResolve({ filter: /^patchwork:icons$/ }, () => ({ path: "icons", namespace: "patchwork-icons" }));
    build.onLoad({ filter: /.*/, namespace: "patchwork-icons" }, () => ({ contents: `export default ${JSON.stringify(iconAssets)};`, loader: "js" }));
  }
};
const config = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
const { version } = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Invalid shared plugin version.");
const plugins = Object.keys(config.plugins);
const ids = new Set();
const sources = new Map();
for (const name of plugins) {
  const { manifest } = config.plugins[name];
  if (!/^[a-z0-9-]+$/.test(name) || !/^[a-z0-9-]+$/.test(manifest.id) || ids.has(manifest.id)) {
    throw new Error(`Invalid or duplicate plugin target: ${name}`);
  }
  if ("version" in manifest) throw new Error("Set the shared version only in plugins/package.json.");
  ids.add(manifest.id);
  sources.set(name, await resolvePluginSource(root, config.plugins[name]));
}
const selected = process.argv.slice(2);
if (selected.some(name => !plugins.includes(name))) throw new Error("Unknown plugin target.");
const targets = selected.length ? selected : plugins;
const run = (script, args = []) => {
  const result = spawnSync(process.execPath, [script, ...args], { cwd: root, stdio: "inherit", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Command failed: ${script}`);
};

run(join(root, "scripts/check-module-boundaries.mjs"));
run(join(projectRoot, "node_modules/typescript/bin/tsc"), ["--project", join(root, "tsconfig.json")]);
for (const name of targets) {
  const { source, entry, styles } = sources.get(name);
  const definition = config.plugins[name];
  const manifest = { ...definition.manifest, version };
  const output = join(projectRoot, "dist", "plugins", manifest.id);
  await mkdir(output, { recursive: true });
  await build({
    absWorkingDir: root,
    entryPoints: [entry],
    outfile: join(output, "main.js"),
    bundle: true,
    format: "cjs",
    platform: "node",
    target: "es2021",
    external: ["obsidian", "electron", "@codemirror/*", "@lezer/*", ...builtinModules, "node:*"],
    define: { __PED_BUILD__: JSON.stringify(manifest.version), __PATCHWORK_PLUGIN_ID__: JSON.stringify(manifest.id) },
    plugins: [iconPlugin],
    supported: { "regexp-lookbehind-assertions": false },
    treeShaking: true,
    logLevel: "info",
    legalComments: "eof",
    sourcemap: false
  });
  const cssEntry = styles;
  await build({ entryPoints: [cssEntry], outfile: join(output, "styles.css"), bundle: true, loader: { ".svg": "dataurl" }, logLevel: "info" });
  if (name === "content") {
    const css = await readFile(join(output, "styles.css"), "utf8");
    for (const selector of [".ped-toolbar", ".pw-document-tab-strip", ".pw-document-top-area"]) {
      if (!css.includes(selector)) throw new Error(`Power Editor stylesheet is incomplete: missing ${selector}. Check src/styles/index.css imports.`);
    }
  }
  if (name === "borders") {
    const css = await readFile(join(output, "styles.css"), "utf8");
    for (const selector of [".pw-window-actions", ".pw-left-panel-actions", ".pw-sidebar-collapse", ".pw-bottom-tools", ".pw-status-path", "--pw-workspace-card-gap"]) {
      if (!css.includes(selector)) throw new Error(`Borders stylesheet is incomplete: missing ${selector}.`);
    }
  }
  if (name === "project") {
    const css = await readFile(join(output, "styles.css"), "utf8");
    for (const selector of [".pw-explorer-controls", ".pw-explorer-context-menu", ".pw-explorer-search-status", "data-pw-menu-style", "data-pw-git-status"]) {
      if (!css.includes(selector)) throw new Error(`Project stylesheet is incomplete: missing ${selector}.`);
    }
  }
  if (name === "git") {
    const css = await readFile(join(output, "styles.css"), "utf8");
    for (const selector of [".pw-git-commit-panel", ".pw-git-log-pane", ".pw-vault-git", ".pw-git-popup", ".pw-git-diff-view", ".pw-tool-tabs"]) {
      if (!css.includes(selector)) throw new Error(`Git stylesheet is incomplete: missing ${selector}.`);
    }
  }
  if (name === "terminal" || name === "claudian") {
    const css = await readFile(join(output, "styles.css"), "utf8");
    const required = name === "terminal" ? [".pw-powershell-session", ".pw-tool-tabs", "data-pw-module"] : [".claudian-container", ".claudian-extension-toolbar", "data-pw-module"];
    for (const selector of required) if (!css.includes(selector)) throw new Error(`${name} stylesheet is incomplete: ${selector}`);
  }
  await writeFile(join(output, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  await cp(join(root, "../LICENSE"), join(output, "LICENSE"));
  run("--check", [join(output, "main.js")]);
  if (name === "content") {
    run(join(root, "scripts/check-power-bundle.mjs"), [output]);
    run(join(root, "scripts/check-power-icons.mjs"), [source]);
  }
  await writeFile(join(output, ".patchwork-files.json"), JSON.stringify({ id: manifest.id, files: config.runtimeFiles }, null, 2) + "\n");
  console.log(`Built ${name} -> ${output}`);
}
