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
 * Operator-managed aliases. They work, but they point at whatever the operator
 * has chosen today, so pinning a real ID is better for reproducibility.
 */
const ALIASES = new Set(["default", "coding", "advanced-vision", "test"]);

/**
 * Models measured as very slow. `qwen3.8:27b` took between 92 and 360 seconds
 * for identical requests during testing, so the UI warns before you pick one.
 */
const SLOW_MODELS = new Set(["qwen3.8:27b", "qwen3.6:35b", "ornith1.5:35b", "ornith1.0:35b"]);

/** Preferred default, in order — fast models first. */
const DEFAULT_PREFERENCE = ["llama3.1:8b", "qwen3.5:9b", "gemma4:26b"];

export type ModelInfo = {
  id: string;
  slow: boolean;
  alias: boolean;
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
    .filter((id): id is string => typeof id === "string" && !NON_CHAT_MODELS.has(id))
    .sort((a, b) => a.localeCompare(b))
    .map((id) => ({ id, slow: SLOW_MODELS.has(id), alias: ALIASES.has(id) }));
}

export function pickDefaultModel(models: ModelInfo[]): string | undefined {
  for (const preferred of DEFAULT_PREFERENCE) {
    if (models.some((model) => model.id === preferred)) return preferred;
  }
  return models.find((model) => !model.alias && !model.slow)?.id ?? models[0]?.id;
}
