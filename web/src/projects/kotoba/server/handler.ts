import "server-only";
import { generateText, NoObjectGeneratedError, Output } from "ai";
import { z } from "zod";
import { soclaas } from "@/lib/soclaas";
import type { EnrichResponse, GenerateResponse, GenerateWord, Question } from "../types";
import { ENRICH_SYSTEM, GENERATE_SYSTEM, enrichUser, generateUser } from "./prompts";

/**
 * Kotoba's one endpoint: POST, dispatched on `action`.
 *
 *   generate  fresh fill-in-the-blank questions for up to MAX_WORDS words
 *   enrich    readings and meanings for words imported without them
 *
 * Model: qwen3.6:35b. Measured on 2026-10-16 against the same five words:
 * it answers in ~3s with no visible reasoning; qwen3.8:27b wrote somewhat
 * richer sentences but took 139s, which no study session can wait for.
 * gemma4:26b returned a gateway 502 after 60s on the same request.
 *
 * `Output.json()` makes the provider send `response_format: json_object`.
 * Without it the model once emitted `"after":。"` — invalid JSON for the
 * whole batch. Items are then validated one at a time, so one bad item costs
 * a retry for that word rather than the whole batch.
 */

const MODEL = "qwen3.6:35b";

/** Batch ceiling. Every request counts against a 30/minute gateway limit. */
const MAX_WORDS = 10;

const generateBody = z.object({
  action: z.literal("generate"),
  level: z.string().max(40),
  words: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        word: z.string().min(1).max(40),
        reading: z.string().max(60).optional(),
        meaning: z.string().max(200).optional(),
        avoid: z.array(z.string().max(300)).max(10),
      }),
    )
    .min(1)
    .max(MAX_WORDS),
});

const enrichBody = z.object({
  action: z.literal("enrich"),
  words: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        word: z.string().min(1).max(40),
        reading: z.string().max(60).optional(),
        meaning: z.string().max(200).optional(),
      }),
    )
    .min(1)
    .max(50),
});

const body = z.discriminatedUnion("action", [generateBody, enrichBody]);

const questionItem = z.object({
  id: z.string(),
  before: z.string(),
  answer: z.string().min(1),
  after: z.string(),
  reading: z.string().min(1),
  form: z.string().default(""),
  translation: z.string().min(1),
});

const enrichItem = z.object({
  id: z.string(),
  reading: z.string(),
  meaning: z.string(),
});

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
}

/** The model's `items` array, or [] when the reply was not shaped like one. */
async function askForItems(system: string, prompt: string, temperature: number): Promise<unknown[]> {
  try {
    const { output } = await generateText({
      model: soclaas()(MODEL),
      instructions: system,
      prompt,
      temperature,
      output: Output.json(),
    });
    const items = (output as { items?: unknown } | null)?.items;
    return Array.isArray(items) ? items : [];
  } catch (error) {
    // A malformed reply is just a retry; a gateway failure is worth surfacing.
    if (NoObjectGeneratedError.isInstance(error)) return [];
    throw error;
  }
}

const HIRAGANA = /^[぀-ゟー]*$/u;

function toHiragana(text: string): string {
  return text.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

/**
 * The answer's reading worked out from the word's own, where possible.
 *
 * The okurigana carry it: 歩く/あるく shares the trailing く, so the stem 歩 reads
 * ある, and 歩いて is ある + いて. Deterministic beats the model here — it is
 * what decides whether typing the kana counts as correct, and the model has
 * been seen returning the dictionary reading instead. Null when the answer
 * does not start with the stem (an irregular form, or kanji the learner did
 * not save a reading for), in which case the model's reading stands.
 */
function deriveReading(word: string, reading: string | undefined, answer: string): string | null {
  const kanaWord = toHiragana(word);
  if (HIRAGANA.test(kanaWord)) {
    const kanaAnswer = toHiragana(answer);
    return HIRAGANA.test(kanaAnswer) ? kanaAnswer : null;
  }
  if (!reading) return null;
  const okurigana = word.match(/[぀-ゟ]*$/u)?.[0] ?? "";
  const stem = word.slice(0, word.length - okurigana.length);
  const kanaReading = toHiragana(reading);
  if (!kanaReading.endsWith(okurigana) || !answer.startsWith(stem)) return null;
  const rest = toHiragana(answer.slice(stem.length));
  if (!HIRAGANA.test(rest)) return null;
  return kanaReading.slice(0, kanaReading.length - okurigana.length) + rest;
}

/**
 * A usable question for `word`, or null.
 *
 * The answer must be non-empty and leave some sentence around it — a blank
 * with nothing on either side tests nothing.
 */
function toQuestion(raw: unknown, word: GenerateWord): Question | null {
  const parsed = questionItem.safeParse(raw);
  if (!parsed.success || parsed.data.id !== word.id) return null;
  const q = parsed.data;
  const answer = q.answer.trim();
  const before = q.before.trim();
  const after = q.after.trim();
  if (!answer || (before + after).length < 4) return null;
  return {
    before,
    answer,
    after,
    reading: deriveReading(word.word, word.reading, answer) ?? q.reading.trim(),
    form: q.form.trim(),
    translation: q.translation.trim(),
  };
}

async function generate(level: string, words: GenerateWord[]): Promise<GenerateResponse> {
  const found = new Map<string, Question>();

  // One retry, for only the words the first pass did not deliver.
  for (let attempt = 0; attempt < 2; attempt++) {
    const missing = words.filter((w) => !found.has(w.id));
    if (missing.length === 0) break;
    // 0.9 produced the odd non-word (近所以); variety comes from "avoid" too.
    const items = await askForItems(GENERATE_SYSTEM, generateUser(level, missing), 0.7);
    for (const word of missing) {
      const raw = items.find((item) => (item as { id?: unknown })?.id === word.id);
      const question = toQuestion(raw, word);
      if (question) found.set(word.id, question);
    }
  }

  return {
    items: [...found].map(([id, question]) => ({ id, question })),
    failed: words.filter((w) => !found.has(w.id)).map((w) => w.id),
  };
}

/** "experience; experience" has been seen; keep each sense once. */
function dedupeSenses(meaning: string): string {
  return [...new Set(meaning.split(/\s*;\s*/).filter(Boolean))].join("; ");
}

async function enrich(words: z.infer<typeof enrichBody>["words"]): Promise<EnrichResponse> {
  const items = await askForItems(ENRICH_SYSTEM, enrichUser(words), 0.2);
  const out: EnrichResponse["items"] = [];
  for (const word of words) {
    const parsed = enrichItem.safeParse(items.find((item) => (item as { id?: unknown })?.id === word.id));
    // The learner's own entries always win over the model's.
    out.push({
      id: word.id,
      reading: word.reading || (parsed.success ? parsed.data.reading.trim() : ""),
      meaning: word.meaning || (parsed.success ? dedupeSenses(parsed.data.meaning.trim()) : ""),
    });
  }
  return { items: out };
}

export async function POST(request: Request) {
  let input: z.infer<typeof body>;
  try {
    const parsed = body.safeParse(await request.json());
    if (!parsed.success) return json({ error: parsed.error.issues[0]?.message ?? "bad request" }, 400);
    input = parsed.data;
  } catch {
    return json({ error: "malformed request" }, 400);
  }

  try {
    if (input.action === "generate") return json(await generate(input.level, input.words));
    return json(await enrich(input.words));
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : "The model request failed." },
      502,
    );
  }
}
