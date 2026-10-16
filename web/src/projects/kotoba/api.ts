import type {
  EnrichRequest,
  EnrichResponse,
  EnrichWord,
  GenerateRequest,
  GenerateResponse,
  GenerateWord,
} from "./types";

const ENDPOINT = "/api/projects/kotoba";

async function post<T>(body: GenerateRequest | EnrichRequest): Promise<T> {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? `Request failed (${response.status}).`);
  return data;
}

export function generateQuestions(level: string, words: GenerateWord[]) {
  return post<GenerateResponse>({ action: "generate", level, words });
}

export function enrichWords(words: EnrichWord[]) {
  return post<EnrichResponse>({ action: "enrich", words });
}
