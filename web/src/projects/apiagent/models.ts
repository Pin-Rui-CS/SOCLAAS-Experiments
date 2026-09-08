/**
 * Models verified to drive THIS loop.
 *
 * A stricter bar than `TOOL_MODELS` in `lib/soclaas.ts`, and deliberately a
 * separate list. That one asks whether a model can emit a well-formed tool
 * call at all. This one asks whether it can run a multi-step dispatcher:
 * call find_apis, read a shortlist back, then construct valid parameters for
 * an API it was told about only in that reply. Those are different abilities
 * and the smaller models have the first without the second.
 *
 * Measured 2026-09-06, same question to each ("How many US banks failed
 * between January and August 2026?", true answer four):
 *
 *   gemma4:26b   PASS  found FDIC, called it, 4 rows, cited Tier A.
 *   qwen3.6:35b  PASS  one call rejected on parameters, read the error,
 *                      corrected it, then answered. The recovery path working.
 *   qwen3.8:27b  PASS  clean on the first attempt.
 *   llama3.1:8b  FAIL  called find_apis, was handed FDIC as a Tier A match,
 *                      never called it, and answered "0 bank failures" with an
 *                      invented URL, an invented query date and the sentence
 *                      "This answer rests on Tier A evidence". Forcing
 *                      tool_choice did not fix it: it then emitted text SHAPED
 *                      like a tool call, with parameter names the schema does
 *                      not have, as its answer.
 *
 * llama3.1:8b is excluded because a fabricated Tier A citation is the single
 * worst output this project can produce — worse than no answer, because it
 * reads as verified. Everything else here exists to prevent exactly that, so
 * shipping a model measured to do it would be self-defeating.
 *
 * This file is client-safe: plain data, no server-only imports, so the picker
 * and the route can share one list rather than drifting apart.
 */
const LOOP_MODELS = new Set(["gemma4:26b", "qwen3.6:35b", "qwen3.8:27b"]);

/**
 * A model missing from the list is not known to be broken, only unverified —
 * the same standing rule as `TOOL_MODELS`. Add one once you have watched it
 * complete a turn with a real API call behind the answer.
 */
export function canDriveLoop(model: string): boolean {
  return LOOP_MODELS.has(model);
}
