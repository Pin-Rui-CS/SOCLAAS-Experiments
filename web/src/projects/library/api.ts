import type { FileKey } from "./types";

/** The project's one endpoint; see server/handler.ts for the views. */
const API = "/api/projects/library";

export async function getJson<T>(query: string): Promise<T> {
  const response = await fetch(`${API}?${query}`);
  const body = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
  return body as T;
}

export const keyOf = (item: { runId: string; questionId: number }) => `${item.runId}|${item.questionId}`;

export const TYPE_LABELS: Record<string, string> = {
  binary: "Binary",
  multiple_choice: "Multiple choice",
  numeric: "Numeric",
  discrete: "Discrete",
};

export const typeLabel = (type: string) => TYPE_LABELS[type] ?? type;

/*
 * The structural boundaries of each stored file (handoff §4). Only these split
 * a file: the research and model transcripts embedded inside carry their own
 * `#`/`##` headings, undemoted, so splitting on every `## ` shreds them.
 * research.md: a planning preamble, then the compiled brief, then one section
 * per provider. runs.md: the shared prompt, then one section per run.
 */
const BOUNDARIES: Partial<Record<FileKey, RegExp>> = {
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

export function fileUrl(runId: string, questionId: number, file: FileKey) {
  return `view=file&run=${encodeURIComponent(runId)}&q=${questionId}&file=${file}`;
}
