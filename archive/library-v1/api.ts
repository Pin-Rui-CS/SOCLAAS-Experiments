import type { FileKey } from "./types";

export { fileSections } from "./files";

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

export function fileUrl(runId: string, questionId: number, file: FileKey) {
  return `view=file&run=${encodeURIComponent(runId)}&q=${questionId}&file=${file}`;
}
