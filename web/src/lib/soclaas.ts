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

/**
 * Models confirmed to emit well-formed tool calls.
 *
 * Measured, like REASONING_MODELS above: each of these was given a tool
 * definition and produced a valid call (SOCLAAS.md, 2026-09-01). The gateway
 * itself executes nothing — it only forwards definitions and returns calls —
 * so this is purely about whether the model can be trusted to emit one.
 *
 * A model missing from this list is not known to be broken, only unverified.
 * Add it once you have actually watched it call a tool.
 */
const TOOL_MODELS = new Set([
  "llama3.1:8b",
  "gemma4:26b",
  "qwen3.6:35b",
  "qwen3.8:27b",
]);

/** Preferred default, in order — fast models first. */
const DEFAULT_PREFERENCE = ["llama3.1:8b", "qwen3.5:9b", "gemma4:26b"];

export type ModelInfo = {
  id: string;
  /** Emits a separate reasoning stream before the answer. */
  reasons: boolean;
  /** Verified to emit well-formed tool calls, so web access can be offered. */
  tools: boolean;
};

export function supportsTools(model: string): boolean {
  return TOOL_MODELS.has(model);
}

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
    .map((id) => ({
      id,
      reasons: REASONING_MODELS.has(id),
      tools: TOOL_MODELS.has(id),
    }));
}

export function pickDefaultModel(models: ModelInfo[]): string | undefined {
  for (const preferred of DEFAULT_PREFERENCE) {
    if (models.some((model) => model.id === preferred)) return preferred;
  }
  return models.find((model) => !model.reasons)?.id ?? models[0]?.id;
}

/**
 * Budget lives on the PORTAL, a different host from the gateway, and is not
 * part of the OpenAI-compatible surface. Not derived from `soclaasBaseUrl`.
 */
const BUDGET_URL = "https://soclaas-portal.comp.nus.edu.sg/api-key/budget";

/** All spend figures are microdollars — 1e6 to the dollar. */
export type Budget = {
  daySpend: number;
  dayAllowance: number;
  monthSpend: number;
  monthAllowance: number;
  requestsPerMinute: number;
  /** Start of the current UTC day window, ISO. */
  dayStart: string | null;
};

type BudgetResponse = {
  policy?: {
    requests_per_minute_limit?: number;
    daily_microdollar_allowance?: number;
    monthly_microdollar_allowance?: number;
  };
  effective_limits?: {
    daily_microdollar_allowance?: number;
    monthly_microdollar_allowance?: number;
  };
  usage?: { current_day_spend?: number; current_month_spend?: number };
  windows?: { day_start?: string };
};

/**
 * Remaining quota for the key this site runs on.
 *
 * Deliberately returns a narrow shape rather than the raw body: the response
 * also carries `api_key.name` and `api_key.prefix`, which identify the key and
 * have no business reaching a browser.
 *
 * `effective_limits` wins over `policy` for allowances — it is what the gateway
 * actually enforces once caps are applied — but the request-rate limit appears
 * only under `policy`.
 */
export async function fetchBudget(): Promise<Budget> {
  const response = await fetch(BUDGET_URL, {
    headers: { Authorization: `Bearer ${env.soclaasApiKey}` },
    // Spend moves with every request, but a chip in the sidebar does not need
    // to be exact; a minute keeps this off the critical path of every page.
    next: { revalidate: 60 },
  });

  if (!response.ok) {
    throw new Error(`portal returned ${response.status} for /api-key/budget`);
  }

  const body = (await response.json()) as BudgetResponse;

  return {
    daySpend: body.usage?.current_day_spend ?? 0,
    dayAllowance:
      body.effective_limits?.daily_microdollar_allowance ??
      body.policy?.daily_microdollar_allowance ??
      0,
    monthSpend: body.usage?.current_month_spend ?? 0,
    monthAllowance:
      body.effective_limits?.monthly_microdollar_allowance ??
      body.policy?.monthly_microdollar_allowance ??
      0,
    requestsPerMinute: body.policy?.requests_per_minute_limit ?? 0,
    dayStart: body.windows?.day_start ?? null,
  };
}
