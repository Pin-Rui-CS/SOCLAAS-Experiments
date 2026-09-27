/**
 * The reader's queries, shaped for the UI. Pure functions over a `Supabase`
 * client, no `server-only`, so they can be exercised from plain Node too.
 *
 * Everything here follows FORECAST-LIBRARY-HANDOFF.md as CORRECTED by
 * `verify.ts` (run 2026-09-27). The corrections that change reader code:
 *
 * - `discrete` is a fourth question type, shaped like numeric.
 * - `extra.ensemble` is parallel to `run_values` only after removing entries
 *   marked `dropped`.
 * - For numeric/discrete, `final_forecast` is the submitted 201-point CDF, not
 *   a run_value; `question_details.scaling.continuous_range` holds its x-values.
 * - Metaculus refuses unauthenticated reads, and with the bot's token the
 *   community aggregate comes back null — so "live" means status and counts,
 *   plus the community forecast only when Metaculus actually sends one.
 */

import { Supabase, gunzip } from "./supabase.ts";
import type {
  CostLine,
  Distribution,
  FileKey,
  ForecastDetail,
  ForecastValue,
  LibraryItem,
  LiveQuestion,
  RunEntry,
} from "../types.ts";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export const FILE_NAMES: Record<FileKey, string> = {
  research: "research.md.gz",
  runs: "runs.md.gz",
  audit: "audit.md.gz",
  evolution: "evolution.md.gz",
};

/** §2: `run_id` is `gh-<id>-<attempt>` or `local-<ts>-<host>`. Anything else is refused. */
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,120}$/;

export function validKey(runId: string | null, questionId: string | null): boolean {
  return !!runId && !!questionId && RUN_ID.test(runId) && /^\d{1,12}$/.test(questionId);
}

// --- Distributions ------------------------------------------------------------

const QUANTILES = [0.1, 0.25, 0.5, 0.75, 0.9];

/**
 * Read quantiles off a Metaculus CDF. `cdf[i]` is P(X ≤ range[i]); the mass
 * below `cdf[0]` and above `cdf[last]` sits outside the question's bounds.
 * Linear interpolation between grid points, which on a 201-point grid is well
 * inside the precision anyone reads a forecast at.
 */
export function summarizeCdf(cdf: number[], range: number[] | null): Distribution | null {
  if (!Array.isArray(cdf) || cdf.length < 2) return null;
  const xs = range && range.length === cdf.length
    ? range
    : cdf.map((_, i) => i / (cdf.length - 1)); // unscaled fallback

  const at = (q: number): number | null => {
    if (q < cdf[0] || q > cdf[cdf.length - 1]) return null; // out of bounds
    for (let i = 1; i < cdf.length; i++) {
      if (cdf[i] >= q) {
        const span = cdf[i] - cdf[i - 1];
        const t = span > 0 ? (q - cdf[i - 1]) / span : 0;
        return xs[i - 1] + t * (xs[i] - xs[i - 1]);
      }
    }
    return xs[xs.length - 1];
  };

  return {
    quantiles: QUANTILES.map((q) => ({ q, value: at(q) })),
    belowRange: cdf[0],
    aboveRange: 1 - cdf[cdf.length - 1],
    scaled: xs === range,
  };
}

function finalValue(type: string, final: unknown, range: number[] | null): ForecastValue | null {
  if (final == null) return null;
  if (type === "binary" && typeof final === "number") return { kind: "binary", p: final };
  if (type === "multiple_choice" && typeof final === "object" && !Array.isArray(final)) {
    return { kind: "mc", options: final as Record<string, number> };
  }
  if (Array.isArray(final)) {
    const distribution = summarizeCdf(final as number[], range);
    return distribution ? { kind: "distribution", distribution } : null;
  }
  return null;
}

/** One ensemble member's own answer, in the terms a reader can compare. */
function runValue(type: string, value: unknown): ForecastValue | null {
  if (value == null) return null;
  if (type === "binary" && typeof value === "number") return { kind: "binary", p: value };
  if (type === "multiple_choice" && typeof value === "object") {
    return { kind: "mc", options: value as Record<string, number> };
  }
  // numeric/discrete: a mixture spec. Report its components; the forecaster
  // records an implied median per component where it computed one.
  const components = ((value as Row).components ?? []).map((c: Row) => ({
    name: c.name ?? c.family ?? "component",
    family: c.family ?? (value as Row).spec?.type ?? "?",
    weight: typeof c.weight === "number" ? c.weight : null,
    p50: typeof c.implied_p50 === "number" ? c.implied_p50 : null,
  }));
  return { kind: "mixture", components };
}

// --- Queries --------------------------------------------------------------------

export async function listLibrary(db: Supabase): Promise<LibraryItem[]> {
  const [library, finals] = await Promise.all([
    db.select<Row>("forecast_library", {
      select:
        "run_id,question_id,post_id,title,question_type,run_at,workflow,submitted,abstained," +
        "total_cost_usd,probability_yes,outcome_status,resolution,metric,score",
      order: "run_at.desc.nullslast",
      limit: "500",
    }),
    // Not in the view (§2: it exposes probability_yes only), so read it out of raw.
    db.select<Row>("forecasts", {
      select:
        "run_id,question_id,final:raw->final_forecast," +
        "range:raw->question_details->scaling->continuous_range,unit:raw->question_details->unit",
      limit: "500",
    }),
  ]);

  const byKey = new Map(finals.rows.map((r) => [`${r.run_id}|${r.question_id}`, r]));
  return library.rows.map((r) => {
    const extra = byKey.get(`${r.run_id}|${r.question_id}`);
    return {
      runId: r.run_id,
      questionId: r.question_id,
      postId: r.post_id,
      title: r.title ?? `Question ${r.question_id}`,
      type: r.question_type,
      runAt: r.run_at,
      workflow: r.workflow,
      submitted: !!r.submitted,
      abstained: !!r.abstained,
      costUsd: r.total_cost_usd == null ? null : Number(r.total_cost_usd),
      final: finalValue(r.question_type, extra?.final, extra?.range ?? null),
      unit: extra?.unit || "",
      outcome: r.outcome_status ?? null,
      resolution: r.resolution ?? null,
      metric: r.metric ?? null,
      score: r.score ?? null,
    };
  });
}

export async function getForecast(
  db: Supabase,
  runId: string,
  questionId: string,
): Promise<ForecastDetail | null> {
  const key = { run_id: `eq.${runId}`, question_id: `eq.${questionId}` };
  const [forecast, calls, outcome] = await Promise.all([
    db.select<Row>("forecasts", { select: "*", ...key }),
    db.select<Row>("llm_calls", {
      select: "model,cost_source,cost_usd,quota_microdollars,native_input_tokens,native_output_tokens,duration_seconds",
      ...key,
      limit: "2000",
    }),
    db.select<Row>("forecast_library", {
      select: "outcome_status,resolution,resolved_at,metric,score",
      ...key,
    }),
  ]);

  const row = forecast.rows[0];
  if (!row) return null;
  const raw: Row = row.raw ?? {};
  const qd: Row = raw.question_details ?? {};
  const type: string = row.question_type ?? raw.question_type ?? "unknown";
  const range: number[] | null = qd.scaling?.continuous_range ?? null;

  // Zip the non-dropped ensemble entries with run_values; dropped ones get no value.
  const values: unknown[] = raw.run_values ?? [];
  let next = 0;
  const runs: RunEntry[] = (raw.extra?.ensemble ?? []).map((e: Row, i: number) => {
    const dropped = !!e.dropped;
    const value = dropped ? null : values[next++];
    return {
      index: i + 1,
      model: e.model ?? "unknown",
      dropped,
      repaired: !!e.repaired,
      valid: e.valid !== false,
      flags: [
        e.used_fallback && "used fallback",
        e.self_contradictory && "self-contradictory",
        typeof e.answer_space_disagreement === "number" &&
          `answer-space disagreement ${e.answer_space_disagreement.toFixed(2)}`,
      ].filter(Boolean) as string[],
      value: runValue(type, value),
    };
  });

  // §5.2: two currencies. Real dollars and quota are summed separately, never added.
  const cost = new Map<string, CostLine>();
  for (const c of calls.rows) {
    const k = `${c.model ?? "?"}|${c.cost_source ?? "?"}`;
    const line = cost.get(k) ?? {
      model: c.model ?? "?",
      source: c.cost_source ?? "?",
      calls: 0,
      usd: 0,
      quotaMicro: 0,
      inputTokens: 0,
      outputTokens: 0,
      seconds: 0,
    };
    line.calls++;
    line.usd += Number(c.cost_usd ?? 0);
    line.quotaMicro += Number(c.quota_microdollars ?? 0);
    line.inputTokens += Number(c.native_input_tokens ?? 0);
    line.outputTokens += Number(c.native_output_tokens ?? 0);
    line.seconds += Number(c.duration_seconds ?? 0);
    cost.set(k, line);
  }

  const o = outcome.rows[0] ?? {};
  return {
    runId: row.run_id,
    questionId: row.question_id,
    postId: row.post_id,
    title: row.title ?? qd.title ?? `Question ${row.question_id}`,
    type,
    runAt: row.run_at,
    workflow: row.workflow,
    runUrl: row.run_url,
    codeSha: row.code_sha,
    schemaVersion: row.schema_version,
    submitted: !!row.submitted,
    abstained: !!row.abstained,
    question: {
      resolutionCriteria: qd.resolution_criteria ?? "",
      fineprint: qd.fine_print ?? "",
      description: qd.description ?? "",
      options: qd.options ?? null,
      unit: qd.unit ?? "",
      statusAtRun: qd.status ?? null,
      closeTime: qd.scheduled_close_time ?? null,
      resolveTime: qd.scheduled_resolve_time ?? null,
    },
    final: finalValue(type, raw.final_forecast, range),
    runs,
    artifactCheck: raw.artifact_check ?? null,
    degradedProviders: raw.degraded_search_providers ?? [],
    timings: raw.timings ?? null,
    cost: [...cost.values()].sort((a, b) => b.usd - a.usd || b.quotaMicro - a.quotaMicro),
    outcome: {
      status: o.outcome_status ?? null,
      resolution: o.resolution ?? null,
      resolvedAt: o.resolved_at ?? null,
      metric: o.metric ?? null,
      score: o.score ?? null,
    },
  };
}

/** §4: a missing file means "not produced", so this returns null rather than throwing. */
export async function getFile(
  db: Supabase,
  runId: string,
  questionId: string,
  file: FileKey,
): Promise<string | null> {
  const bytes = await db.download(`runs/${runId}/${questionId}/${FILE_NAMES[file]}`);
  return bytes ? await gunzip(bytes) : null;
}

// --- Metaculus ------------------------------------------------------------------

const METACULUS = "https://www.metaculus.com/api";
const LIVE_TTL_MS = 10 * 60_000;
const liveCache = new Map<number, { at: number; value: LiveQuestion }>();
let lastCall = 0;

/**
 * Status and community forecast right now, from `/posts/<post_id>/` — one
 * request gives post-level counts and the nested question.
 *
 * §6 asks for ~3s between requests. A serverless instance can't coordinate
 * with its siblings, so this enforces the gap per instance and leans on a
 * ten-minute cache; the UI fetches on demand, never in bulk.
 */
export async function getLive(token: string, postId: number): Promise<LiveQuestion> {
  const cached = liveCache.get(postId);
  if (cached && Date.now() - cached.at < LIVE_TTL_MS) return { ...cached.value, cached: true };

  const wait = lastCall + 3000 - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastCall = Date.now();

  const response = await fetch(`${METACULUS}/posts/${postId}/`, {
    headers: { Authorization: `Token ${token}` },
    cache: "no-store",
  });
  if (response.status === 429) {
    const retry = response.headers.get("retry-after");
    throw new Error(`Metaculus rate limit; retry after ${retry ?? "a while"}s`);
  }
  if (!response.ok) throw new Error(`Metaculus ${response.status}`);

  const post: Row = await response.json();
  const q: Row = post.question ?? {};
  const latest: Row | null = q.aggregations?.recency_weighted?.latest ?? null;

  let community: ForecastValue | null = null;
  if (latest) {
    const fv: number[] | undefined = latest.forecast_values;
    if (q.type === "binary" && Array.isArray(latest.centers)) {
      community = { kind: "binary", p: latest.centers[0] };
    } else if (q.type === "multiple_choice" && Array.isArray(fv) && Array.isArray(q.options)) {
      community = {
        kind: "mc",
        options: Object.fromEntries(q.options.map((o: string, i: number) => [o, fv[i]])),
      };
    } else if (Array.isArray(fv)) {
      const distribution = summarizeCdf(fv, q.scaling?.continuous_range ?? null);
      if (distribution) community = { kind: "distribution", distribution };
    }
  }

  const value: LiveQuestion = {
    status: q.status ?? post.status ?? null,
    resolution: q.resolution ?? null,
    closeTime: q.scheduled_close_time ?? null,
    cpRevealTime: q.cp_reveal_time ?? null,
    forecasters: post.nr_forecasters ?? null,
    forecasts: post.forecasts_count ?? null,
    community,
    fetchedAt: new Date().toISOString(),
    cached: false,
  };
  liveCache.set(postId, { at: Date.now(), value });
  return value;
}
