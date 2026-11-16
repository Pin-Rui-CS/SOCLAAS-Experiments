import type { FileKey } from "./types.ts";

/**
 * How the stored markdown files divide into sections. Pure, so the client (the
 * Files tab) and the server (the chat's context pack and file tool, the brief
 * download) split them identically.
 */

/*
 * The structural boundaries of each stored file (handoff §4). Only these split
 * a file: the research and model transcripts embedded inside carry their own
 * `#`/`##` headings, undemoted, so splitting on every `## ` shreds them.
 * research.md: a planning preamble, then the compiled brief, then one section
 * per provider. runs.md: the shared prompt, then one section per run.
 */
export const BOUNDARIES: Partial<Record<FileKey, RegExp>> = {
  research: /^(?=## (?:Compiled Brief \(sent to forecaster\)|Provider: .*)\s*$)/m,
  runs: /^(?=## (?:Prompt \(identical for every run\)|Run \d+)\s*$)/m,
};

export function fileSections(text: string, file: FileKey): { heading: string; body: string }[] {
  const boundary = BOUNDARIES[file];
  if (!boundary) return [{ heading: "", body: text }];
  return text
    .split(boundary)
    .map((chunk, i) => {
      const newline = chunk.indexOf("\n");
      const first = newline < 0 ? chunk : chunk.slice(0, newline);
      if (i > 0 || first.startsWith("## ")) {
        return { heading: first.slice(3).trim(), body: newline < 0 ? "" : chunk.slice(newline + 1) };
      }
      return { heading: "Preamble", body: chunk };
    })
    .filter((part) => part.body.trim());
}
