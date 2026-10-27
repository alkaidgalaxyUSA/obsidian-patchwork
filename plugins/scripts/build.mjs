import { build } from "esbuild";
import { builtinModules } from "node:module";
import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const iconRoot = resolve(root, "../icons");
const iconAssets = {};
for (const file of (await readdir(iconRoot)).sort()) {
  if (!/^(action-|code-)[a-z0-9-]+\.svg$/.test(file)) continue;
  const key = file.replace(/^action-/, "").replace(/\.svg$/, "");
  if (key in iconAssets) throw new Error(`Duplicate icon key: ${key}`);
  iconAssets[key] = await readFile(join(iconRoot, file), "utf8");
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
for (const name of plugins) {
  const { manifest } = config.plugins[name];
  if (!/^[a-z0-9-]+$/.test(name) || !/^[a-z0-9-]+$/.test(manifest.id) || ids.has(manifest.id)) {
    throw new Error(`Invalid or duplicate plugin target: ${name}`);
  }
  if ("version" in manifest) throw new Error("Set the shared version only in plugins/package.json.");
  ids.add(manifest.id);
}
const selected = process.argv.slice(2);
if (selected.some(name => !plugins.includes(name))) throw new Error("Unknown plugin target.");
const targets = selected.length ? selected : plugins;
const run = (script, args = []) => {
  const result = spawnSync(process.execPath, [script, ...args], { cwd: root, stdio: "inherit", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Command failed: ${script}`);
};

run(join(root, "node_modules/typescript/bin/tsc"), ["--project", join(root, "tsconfig.json")]);
for (const name of targets) {
  const source = join(root, name);
  const definition = config.plugins[name];
  const manifest = { ...definition.manifest, version };
  const output = join(root, "dist", manifest.id);
  await mkdir(output, { recursive: true });
  await build({
    absWorkingDir: root,
    entryPoints: [join(source, "src/main.ts")],
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
  const cssEntry = join(source, definition.styles);
  await build({ entryPoints: [cssEntry], outfile: join(output, "styles.css"), bundle: true, loader: { ".svg": "dataurl" }, logLevel: "info" });
  await writeFile(join(output, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  await cp(join(root, "../LICENSE"), join(output, "LICENSE"));
  run("--check", [join(output, "main.js")]);
  if (name === "power-editor") {
    run(join(root, "scripts/check-power-bundle.mjs"), [output]);
    run(join(root, "scripts/check-power-icons.mjs"), [source]);
  }
  await writeFile(join(output, ".patchwork-files.json"), JSON.stringify({ id: manifest.id, files: config.runtimeFiles }, null, 2) + "\n");
  console.log(`Built ${name} -> ${output}`);
}
