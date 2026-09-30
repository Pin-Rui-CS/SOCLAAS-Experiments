/**
 * One forecast, written up as a single markdown document: what the question
 * asks, what the bot answered and how each model voted, what evidence it had,
 * and the research brief the models read.
 *
 * Two consumers. The Discuss chat gives it to the model as its briefing, and
 * the "brief" download hands the same file to the user for use elsewhere.
 *
 * Sized for the models the chat allows (all ≥128K tokens): about 10K tokens,
 * dominated by the compiled brief. The full research and the run transcripts
 * are NOT inlined — ~60K and ~26K tokens respectively — only indexed at the end,
 * so the chat can fetch a section with `read_forecast_file` when it needs one.
 *
 * Plain Node compatible (`.ts` imports, no `server-only`).
 */

import { Supabase } from "./supabase.ts";
import { getFile, getForecast } from "./library.ts";
import { summarizeCdf } from "../cdf.ts";
import { fileSections } from "../files.ts";
import type { FileKey, ForecastDetail, ForecastValue } from "../types.ts";

export const FILE_KEYS: FileKey[] = ["research", "runs", "evolution", "audit"];

const BACKGROUND_CAP = 4_000;
const BRIEF_CAP = 40_000;
const CACHE_MS = 10 * 60_000;
const CACHE_MAX = 20;

export type ForecastContext = {
  detail: ForecastDetail;
  /** Decompressed file texts; null where the run did not produce the file. */
  texts: Record<FileKey, string | null>;
  markdown: string;
};

const cache = new Map<string, { at: number; value: ForecastContext }>();

export class NotFoundError extends Error {}

export async function buildContext(db: Supabase, runId: string, questionId: string): Promise<ForecastContext> {
  const key = `${runId}|${questionId}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;

  const [detail, ...files] = await Promise.all([
    getForecast(db, runId, questionId),
    ...FILE_KEYS.map((f) => getFile(db, runId, questionId, f)),
  ]);
  if (!detail) throw new NotFoundError(`no forecast ${runId}/${questionId}`);

  const texts = Object.fromEntries(FILE_KEYS.map((f, i) => [f, files[i]])) as Record<FileKey, string | null>;
  const value = { detail, texts, markdown: render(detail, texts) };

  cache.set(key, { at: Date.now(), value });
  // Drop the oldest once the cache is full; each entry holds a few hundred KB of text.
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
  return value;
}

// --- Rendering -------------------------------------------------------------------

const pct = (p: number) => `${(p * 100).toFixed(1).replace(/\.0$/, "")}%`;

function num(value: number | null | undefined, unit: string): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  const text =
    abs >= 1e12 ? `${(value / 1e12).toPrecision(4)}T`
    : abs >= 1e9 ? `${(value / 1e9).toPrecision(4)}B`
    : abs >= 1e6 ? `${(value / 1e6).toPrecision(4)}M`
    : abs >= 1e4 ? `${(value / 1e3).toPrecision(4)}K`
    : String(Number(value.toPrecision(4)));
  return unit ? `${text} ${unit}` : text;
}

function cap(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}\n\n[… truncated at ${limit} of ${text.length} characters]`;
}

function describeValue(value: ForecastValue | null, unit: string): string {
  if (!value) return "no forecast";
  switch (value.kind) {
    case "binary":
      return `${pct(value.p)} Yes`;
    case "mc":
      return Object.entries(value.options)
        .sort((a, b) => b[1] - a[1])
        .map(([o, p]) => `${o} ${pct(p)}`)
        .join(", ");
    case "distribution": {
      const q = (level: number) => value.distribution.quantiles.find((x) => x.q === level);
      const show = (x: ReturnType<typeof q>) =>
        !x ? "—" : x.value == null ? `${x.side ?? "out of"} range` : num(x.value, unit);
      return (
        `median ${show(q(0.5))}; 80% interval ${show(q(0.1))} to ${show(q(0.9))}; ` +
        `${pct(value.distribution.belowRange)} below the question's range, ${pct(value.distribution.aboveRange)} above`
      );
    }
    case "mixture":
      return value.components
        .map((c) => `${c.weight != null ? pct(c.weight) + " " : ""}${c.family}${c.name !== c.family ? ` "${c.name}"` : ""}${c.p50 != null ? ` (p50 ${num(c.p50, unit)})` : ""}`)
        .join("; ");
  }
}

function render(d: ForecastDetail, texts: Record<FileKey, string | null>): string {
  const unit = d.question.unit;
  const lines: string[] = [];
  const push = (...xs: string[]) => lines.push(...xs);

  // 1. Question
  push(`# ${d.title}`, "");
  push(
    `- Metaculus question ${d.questionId}${d.postId ? ` (post ${d.postId}, https://www.metaculus.com/questions/${d.postId}/)` : ""}`,
    `- Type: ${d.type.replace("_", " ")}${unit ? ` · unit: ${unit}` : ""}`,
  );
  if (d.competitions?.length) push(`- Competition: ${d.competitions.map((c) => c.name ?? c.slug).join(", ")}`);
  push(
    `- Closes ${d.question.closeTime ?? "?"} · resolves ${d.question.resolveTime ?? "?"} (as recorded when the bot ran)`,
    `- Bot run ${d.runId} on ${d.runAt ?? "?"}; ${d.abstained ? "abstained" : d.submitted ? "submitted to Metaculus" : "NOT submitted (test or dry run)"}`,
  );
  if (d.question.options?.length) push(`- Options: ${d.question.options.join(" | ")}`);
  push("", "## Resolution criteria", "", d.question.resolutionCriteria || "(none recorded)");
  if (d.question.fineprint) push("", "## Fine print", "", d.question.fineprint);
  if (d.question.description) push("", "## Background", "", cap(d.question.description, BACKGROUND_CAP));

  // 2. The forecast
  push("", "## The bot's forecast", "");
  push(`Submitted: ${describeValue(d.final, unit)}`, "");
  const rule =
    d.type === "binary" ? "the median of the used runs"
    : d.type === "multiple_choice" ? "the mean of the used runs"
    : "a quantile average of the used runs' CDFs, then smoothed";
  push(`Aggregation: ${rule}. Dropped runs are excluded.`, "", "Each run (ensemble member):", "");

  const curveOf = (index: number) => d.curves?.series.find((s) => s.runIndex === index);
  for (const run of d.runs) {
    const flags = [run.dropped && "DROPPED", run.repaired && "repaired", ...run.flags].filter(Boolean).join(", ");
    let answer = run.dropped ? "excluded from the aggregate" : describeValue(run.value, unit);
    const curve = curveOf(run.index);
    if (curve && d.curves) {
      const s = summarizeCdf(curve.cdf, d.curves.x, [0.1, 0.5, 0.9]);
      if (s) answer = describeValue({ kind: "distribution", distribution: s }, unit) + ` — from: ${answer}`;
    }
    push(`- Run ${run.index} · ${run.model}${flags ? ` [${flags}]` : ""}: ${answer}`);
  }

  // 3. Evidence
  const a = d.artifactCheck;
  push("", "## Evidence check (the bot's own audit of its research)", "");
  if (!a) push("(none recorded)");
  else {
    push(`- Status: ${a.status ?? "?"}${a.forecast_swing ? ` · forecast swing if the missing evidence arrived: ${a.forecast_swing}` : ""}`);
    if (a.what_was_found) push(`- Found: ${a.what_was_found}`);
    if (a.what_is_missing) push(`- Missing: ${a.what_is_missing}`);
    if (a.closest_available) push(`- Closest available: ${a.closest_available}`);
  }
  if (d.degradedProviders.length) push(`- Degraded search providers: ${d.degradedProviders.join(", ")}`);

  // 4. The brief
  const brief = texts.research
    ? fileSections(texts.research, "research").find((s) => s.heading.startsWith("Compiled Brief"))?.body
    : null;
  push("", "## Research brief given to the forecasting models", "");
  push(brief ? cap(brief.trim(), BRIEF_CAP) : "(no compiled brief in this run's research file)");

  // 5. Index of the rest
  push("", "## Other stored files", "");
  for (const f of FILE_KEYS) {
    const text = texts[f];
    if (text === null) {
      push(`- ${f}: not produced for this run`);
      continue;
    }
    const parts = fileSections(text, f).filter((p) => p.heading);
    push(
      parts.length
        ? `- ${f} (${Math.round(text.length / 1000)}K chars), sections: ${parts.map((p) => `"${p.heading}" (${Math.round(p.body.length / 1000)}K)`).join(", ")}`
        : `- ${f} (${Math.round(text.length / 1000)}K chars, one section)`,
    );
  }

  return lines.join("\n");
}

// --- The chat's file tool ----------------------------------------------------------

export const SECTION_CHUNK = 24_000;

/**
 * One section of one file, paged. An unknown section answers with the list of
 * real ones rather than throwing, so a model that guessed a name can correct
 * itself on the next step.
 */
export function readSection(
  ctx: ForecastContext,
  file: FileKey,
  section: string | undefined,
  offset = 0,
): { file: FileKey; section: string | null; text?: string; offset?: number; nextOffset?: number | null; totalChars?: number; error?: string; sections?: string[] } {
  const text = ctx.texts[file];
  if (text == null) return { file, section: section ?? null, error: `${file} was not produced for this run` };

  const parts = fileSections(text, file);
  const named = parts.filter((p) => p.heading);
  let body = text;
  let heading: string | null = null;

  if (section) {
    const wanted = section.trim().toLowerCase();
    const match =
      named.find((p) => p.heading.toLowerCase() === wanted) ??
      named.find((p) => p.heading.toLowerCase().includes(wanted));
    if (!match) {
      return { file, section, error: `no section "${section}" in ${file}`, sections: named.map((p) => p.heading) };
    }
    body = match.body;
    heading = match.heading;
  }

  const start = Math.max(0, Math.min(offset, body.length));
  const end = Math.min(body.length, start + SECTION_CHUNK);
  return {
    file,
    section: heading,
    text: body.slice(start, end),
    offset: start,
    nextOffset: end < body.length ? end : null,
    totalChars: body.length,
  };
}
