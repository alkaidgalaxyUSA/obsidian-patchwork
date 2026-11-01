import { lstat, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

function assertChild(parent, child) {
  const path = relative(parent, child);
  if (!path || path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path)) {
    throw new Error(`Plugin path escapes its intended directory: ${child}`);
  }
}

async function resolveChild(parent, path) {
  const child = resolve(parent, path);
  assertChild(parent, child);
  for (let cursor = child; cursor !== parent; cursor = dirname(cursor)) {
    if ((await lstat(cursor)).isSymbolicLink()) throw new Error(`Linked plugin paths are not supported: ${cursor}`);
  }
  assertChild(await realpath(parent), await realpath(child));
  return child;
}

/** Validate sources before any build artifact is created, including nested roots. */
export async function resolvePluginSource(root, definition) {
  if (typeof definition.source !== "string" || !/^[a-z0-9-]+(?:\/[a-z0-9-]+)*$/.test(definition.source)) {
    throw new Error("Plugin source must be an explicit relative directory within plugins/.");
  }
  if (typeof definition.styles !== "string" || !/^(?:[a-z0-9-]+\/)*[a-z0-9-]+\.css$/.test(definition.styles)) {
    throw new Error("Plugin stylesheet must be a relative CSS entry within its source directory.");
  }
  const source = await resolveChild(root, definition.source);
  if (!(await lstat(source)).isDirectory()) throw new Error(`Plugin source is not a directory: ${source}`);
  const entry = await resolveChild(source, "src/main.ts");
  const styles = await resolveChild(source, definition.styles);
  for (const path of [entry, styles]) {
    if (!(await lstat(path)).isFile()) throw new Error(`Plugin entry is not a file: ${path}`);
  }
  return { source, entry, styles };
}
