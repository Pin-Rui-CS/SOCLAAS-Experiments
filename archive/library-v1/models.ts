/**
 * Models offered in the Discuss chat. Client-safe plain data, so the picker and
 * the route share one list.
 *
 * Two bars, both measured elsewhere in this repo:
 * - they drive a multi-step tool loop (apiagent/models.ts, 2026-09-06) — the
 *   chat reads transcripts through `read_forecast_file`, often mid-answer;
 * - their context is ≥128K tokens (SOCLAAS.md) — the briefing alone is ~7–10K
 *   tokens and a single run transcript can add 20K.
 *
 * llama3.1:8b fails the first bar in the measured, worst way: it fabricated a
 * cited answer rather than calling the tool it was pointed at. qwen3.6:35b is the
 * default: it answers in seconds with no visible reasoning, where qwen3.8:27b
 * can think for minutes.
 */
export const CHAT_MODELS = ["qwen3.6:35b", "qwen3.8:27b", "gemma4:26b"] as const;

export const DEFAULT_CHAT_MODEL = CHAT_MODELS[0];

export function isChatModel(model: string): boolean {
  return (CHAT_MODELS as readonly string[]).includes(model);
}
