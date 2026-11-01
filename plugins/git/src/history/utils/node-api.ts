/*! Adapted from Obsidian Git History. Copyright (c) 2025 Chris Oguntolu. MIT License. */
export { execFile } from "node:child_process";
export { readFile, writeFile } from "node:fs/promises";
export function processEnv(): Record<string, string | undefined> { return process.env; }
