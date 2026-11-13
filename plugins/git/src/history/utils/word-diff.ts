/*! Adapted from Obsidian Git History 1.13.0. Copyright (c) 2025 Chris Oguntolu. MIT License. */
import { diffWordsWithSpace } from "./word-changes";
import type { DiffLine } from "../types";

/** A stretch of one line's text, and whether it is part of what changed. */
export interface Segment {
  value: string;
  changed: boolean;
  type?: "add" | "del" | "modify";
}

export interface WordDiff {
  old: Segment[];
  new: Segment[];
}

/**
 * A row of the diff: an unchanged line, a removed line shown against the line
 * that replaced it, or a line removed or added with nothing opposite.
 */
export interface LinePair {
  type: "context" | "modify" | "add" | "del";
  left?: DiffLine;
  right?: DiffLine;
}

/**
 * Below this share of common text, two lines are treated as unrelated: marking
 * the few words they happen to share would highlight nearly the whole line and
 * say less than the line colour already does.
 */
export const MIN_SHARED = 0.4;

/** A word diff that takes longer than this is dropped rather than waited for. */
export const WORD_DIFF_TIMEOUT_MS = 50;

/**
 * Pairs each run of removed lines with the run of added lines after it, in
 * order, so a changed line can be shown next to its replacement. Whatever is
 * left over on either side stays unpaired.
 */
export function pairLines(lines: readonly DiffLine[]): LinePair[] {
  const result: LinePair[] = [];
  let i = 0;

  while (i < lines.length) {
    if (lines[i].type === "context") {
      result.push({ type: "context", left: lines[i] });
      i++;
      continue;
    }

    const delStart = i;
    while (i < lines.length && lines[i].type === "del") i++;
    const dels = lines.slice(delStart, i);

    const addStart = i;
    while (i < lines.length && lines[i].type === "add") i++;
    const adds = lines.slice(addStart, i);

    result.push(...alignLines(dels, adds));
  }

  return result;
}

/** Bounded, ordered similarity matching avoids shifting every pair after an insertion. */
function alignLines(dels: readonly DiffLine[], adds: readonly DiffLine[]): LinePair[] {
  const positional = (): LinePair[] => Array.from({ length: Math.max(dels.length, adds.length) }, (_, index) => ({
    type: dels[index] && adds[index] ? "modify" : dels[index] ? "del" : "add",
    left: dels[index], right: adds[index],
  }));
  if (!dels.length || !adds.length || dels.length * adds.length > 20000) return positional();
  const tokens = (line: DiffLine) => new Set(line.content.slice(0, 2000).match(/[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu) ?? []);
  const left = dels.map(tokens), right = adds.map(tokens);
  const width = adds.length + 1, scores = new Float32Array((dels.length + 1) * width);
  const similarity = (i: number, j: number): number => {
    if (dels[i].content.trim() === adds[j].content.trim()) return 2;
    const common = [...left[i]].filter(token => right[j].has(token)).length;
    const share = 2 * common / Math.max(1, left[i].size + right[j].size);
    return share >= MIN_SHARED ? share : 0;
  };
  const deadline = Date.now() + WORD_DIFF_TIMEOUT_MS;
  for (let i = dels.length - 1; i >= 0; i--) {
    if (Date.now() > deadline) return positional();
    for (let j = adds.length - 1; j >= 0; j--) {
      const match = similarity(i, j);
      scores[i * width + j] = Math.max(scores[(i + 1) * width + j], scores[i * width + j + 1], match ? match + scores[(i + 1) * width + j + 1] : 0);
    }
  }
  if (!scores[0]) return positional();
  const pairs: LinePair[] = [];
  let i = 0, j = 0;
  while (i < dels.length || j < adds.length) {
    const match = i < dels.length && j < adds.length ? similarity(i, j) : 0;
    if (match && Math.abs(scores[i * width + j] - match - scores[(i + 1) * width + j + 1]) < 0.001) {
      pairs.push({ type: "modify", left: dels[i++], right: adds[j++] });
    } else if (i < dels.length && (j === adds.length || scores[(i + 1) * width + j] >= scores[i * width + j + 1])) {
      pairs.push({ type: "del", left: dels[i++] });
    } else pairs.push({ type: "add", right: adds[j++] });
  }
  return pairs;
}

/**
 * The words that differ between the old and the new version of a line, or
 * null when there is nothing worth marking: the lines have too little in
 * common, or comparing them took too long.
 *
 * Words are compared whole, letters beyond ASCII included, so a change to
 * "überladen" marks that word rather than "berladen" next to an unmarked "ü".
 * Whitespace is compared too, since a changed indent or a trailing space is
 * exactly the change nothing else on screen would show.
 */
export function wordDiff(oldText: string, newText: string): WordDiff | null {
  const parts = diffWordsWithSpace(oldText, newText, { timeout: WORD_DIFF_TIMEOUT_MS });
  if (!parts) return null;

  const oldSegs: Segment[] = [];
  const newSegs: Segment[] = [];
  let shared = 0;
  for (const part of parts) {
    if (part.removed) {
      push(oldSegs, part.value, true);
    } else if (part.added) {
      push(newSegs, part.value, true);
    } else {
      push(oldSegs, part.value, false);
      push(newSegs, part.value, false);
      shared += visibleLength(part.value);
    }
  }

  // Whitespace is left out of the share: two unrelated sentences have their
  // spaces in common, and that would pass them off as related.
  const longer = Math.max(visibleLength(oldText), visibleLength(newText));
  if (longer === 0 || shared / longer < MIN_SHARED) return null;
  let oldIndex = 0, newIndex = 0;
  for (let index = 0; index < parts.length;) {
    if (!parts[index].added && !parts[index].removed) { index++; continue; }
    const run = [];
    while (index < parts.length && (parts[index].added || parts[index].removed)) run.push(parts[index++]);
    const removed = run.some(part => part.removed), added = run.some(part => part.added);
    if (removed) {
      while (!oldSegs[oldIndex]?.changed && oldIndex < oldSegs.length) oldIndex++;
      if (oldSegs[oldIndex]) oldSegs[oldIndex++].type = added ? "modify" : "del";
    }
    if (added) {
      while (!newSegs[newIndex]?.changed && newIndex < newSegs.length) newIndex++;
      if (newSegs[newIndex]) newSegs[newIndex++].type = removed ? "modify" : "add";
    }
  }
  return { old: oldSegs, new: newSegs };
}

/** Appends to the last segment when it has the same state, so runs stay whole. */
function push(segments: Segment[], value: string, changed: boolean): void {
  const last = segments[segments.length - 1];
  if (last && last.changed === changed) last.value += value;
  else segments.push({ value, changed });
}

function visibleLength(text: string): number {
  return text.replace(/\s/g, "").length;
}
