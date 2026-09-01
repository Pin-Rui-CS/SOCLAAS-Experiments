import "server-only";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { env } from "./env";

/**
 * The SoCLaaS gateway, server-side only.
 *
 * Verified against the live gateway: `qwen3.8:27b` returns its thinking in a
 * separate `reasoning` field, and this provider surfaces it as proper
 * `reasoning-*` stream parts rather than dropping it.
 */
export function soclaas() {
  return createOpenAICompatible({
    name: "soclaas",
    baseURL: env.soclaasBaseUrl,
    apiKey: env.soclaasApiKey,
  });
}

/**
 * Models in the catalogue that would fail a chat request. `/v1/models` lists
 * embedding and audio models alongside chat ones, and sending a conversation to
 * either fails at the gateway rather than in any way we could recover from.
 */
const NON_CHAT_MODELS = new Set(["bge-m3", "whisper-large-v3"]);

/**
 * Operator-managed aliases, hidden from the picker.
 *
 * Each is a duplicate of a model already in the list — matched by context
 * window, exact pricing, and description:
 *
 *   default         -> qwen3.6:35b
 *   advanced-vision -> qwen3-vl:32b
 *   test            -> qwen3-vl:32b
 *   coding          -> qwen3.6:27b / qwen3.8:27b  (NOT qwen3-coder-next,
 *                      despite the name — that model prices differently)
 *
 * They add nothing but confusion, and the operator can repoint them at any
 * time, so a conversation held with "default" is not reproducible.
 */
const ALIASES = new Set(["default", "coding", "advanced-vision", "test"]);

/**
 * Models that emit a separate `reasoning` field before answering.
 *
 * Measured, not guessed: each was asked "what is 12 times 8" and checked for a
 * reasoning field. This is the difference a user actually feels — these fill
 * the thinking panel and take variable time, from seconds on an easy question
 * to minutes on a hard one (qwen3.8:27b once took 360s).
 *
 * Note it is NOT about model size. qwen3.6:35b is one of the largest here and
 * does no visible reasoning at all, answering in well under a second.
 */
const REASONING_MODELS = new Set([
  "qwen3.5:9b",
  "gemma4:26b",
  "qwen3.6:27b",
  "qwen3.8:27b",
  "ornith1.0:35b",
  "ornith1.5:35b",
]);

/** Preferred default, in order — fast models first. */
const DEFAULT_PREFERENCE = ["llama3.1:8b", "qwen3.5:9b", "gemma4:26b"];

export type ModelInfo = {
  id: string;
  /** Emits a separate reasoning stream before the answer. */
  reasons: boolean;
};

export async function listModels(): Promise<ModelInfo[]> {
  const response = await fetch(`${env.soclaasBaseUrl}/models`, {
    headers: { Authorization: `Bearer ${env.soclaasApiKey}` },
    // the catalogue changes rarely; don't pay for it on every page load
    next: { revalidate: 300 },
  });

  if (!response.ok) {
    throw new Error(`gateway returned ${response.status} for /models`);
  }

  const body = (await response.json()) as { data?: Array<{ id?: string }> };

  return (body.data ?? [])
    .map((model) => model.id)
    .filter(
      (id): id is string =>
        typeof id === "string" && !NON_CHAT_MODELS.has(id) && !ALIASES.has(id),
    )
    .sort((a, b) => a.localeCompare(b))
    .map((id) => ({ id, reasons: REASONING_MODELS.has(id) }));
}

export function pickDefaultModel(models: ModelInfo[]): string | undefined {
  for (const preferred of DEFAULT_PREFERENCE) {
    if (models.some((model) => model.id === preferred)) return preferred;
  }
  return models.find((model) => !model.reasons)?.id ?? models[0]?.id;
}
