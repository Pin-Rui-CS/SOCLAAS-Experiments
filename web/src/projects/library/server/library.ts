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
 * - For numeric/discrete, `final_forecast` is the submitted CDF, not a
 *   run_value; `question_details.scaling.continuous_range` holds its x-values.
 *   201 points for numeric, `outcome_count + 1` for discrete.
 * - Per-run CDFs are not stored, but each run's `spec` is exactly what the bot
 *   rendered, so `distributions.ts` reproduces them (checked against the bot's
 *   `spec_to_cdf`: max difference 5e-8).
 * - Metaculus refuses unauthenticated reads, and with the bot's token the
 *   community aggregate comes back null — so "live" means status and counts,
 *   plus the community forecast only when Metaculus actually sends one.
 */

import { Supabase, SupabaseError, gunzip } from "./supabase.ts";
import { specCdf } from "./distributions.ts";
import { summarizeCdf } from "../cdf.ts";
import { DIAGNOSTIC_STATUSES } from "../types.ts";
import type {
  Competition,
  CostLine,
  Curves,
  DiagnosticCheck,
  DiagnosticsSummary,
  FileKey,
  ForecastDetail,
  ForecastValue,
  LibraryItem,
  LiveQuestion,
  RunEntry,
  Spread,
} from "../types.ts";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export const FILE_NAMES: Record<FileKey, string> = {
  research: "research.md.gz",
  runs: "runs.md.gz",
  audit: "audit.md.gz",
  evolution: "evolution.md.gz",
  diagnostics: "diagnostics.md.gz",
};

/** §2: `run_id` is `gh-<id>-<attempt>` or `local-<ts>-<host>`. Anything else is refused. */
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,120}$/;

export function validKey(runId: string | null, questionId: string | null): boolean {
  return !!runId && !!questionId && RUN_ID.test(runId) && /^\d{1,12}$/.test(questionId);
}

// --- Distributions ------------------------------------------------------------

export { summarizeCdf };

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

/**
 * What the row itself says about its competition. `raw.tournaments` is the
 * post's own list (bot, 2026-09-27 on). Older rows may only carry the slugs the
 * run was launched with, which have no display name. Neither → `null`, and the
 * client asks Metaculus via `getTournaments`.
 */
function competitionsOf(row: Row | undefined): Competition[] | null {
  if (Array.isArray(row?.tournaments)) {
    return row.tournaments
      .filter((t: Row) => t && (t.slug || t.name))
      .map((t: Row) => ({ slug: String(t.slug ?? t.name), name: t.name ?? null }));
  }
  if (Array.isArray(row?.cli_tournaments) && row.cli_tournaments.length) {
    return row.cli_tournaments.map((slug: unknown) => ({ slug: String(slug), name: null }));
  }
  return null;
}

// --- Diagnostics (addendum: run_diagnostics, diagnostics_summary) -----------------

/**
 * PostgREST's answer when a relation does not exist — the state until the bot
 * owner applies 003_run_diagnostics.sql. Addendum §10: treat it as "no
 * diagnostics", never as an error.
 */
function isMissingRelation(error: unknown): boolean {
  return (
    error instanceof SupabaseError &&
    (error.status === 404 || /PGRST205|PGRST204|42P01|does not exist|schema cache/i.test(error.body))
  );
}

async function optional<T>(read: Promise<T>, fallback: T): Promise<T> {
  try {
    return await read;
  } catch (error) {
    if (isMissingRelation(error)) return fallback;
    throw error;
  }
}

export async function listDiagnosticSummaries(db: Supabase): Promise<Map<string, DiagnosticsSummary>> {
  const { rows } = await optional(
    db.select<Row>("diagnostics_summary", { select: "run_id,question_id,diagnosed_at,fails,warns,passes,skipped", limit: "1000" }),
    { rows: [] as Row[], count: null },
  );
  return new Map(
    rows.map((r) => [
      `${r.run_id}|${r.question_id}`,
      {
        fails: Number(r.fails ?? 0),
        warns: Number(r.warns ?? 0),
        passes: Number(r.passes ?? 0),
        skipped: Number(r.skipped ?? 0),
        diagnosedAt: r.diagnosed_at ?? null,
      },
    ]),
  );
}

/** Every check for one forecast, worst first (fail → warn → info → pass → skipped). */
export async function getDiagnostics(db: Supabase, runId: string, questionId: string): Promise<DiagnosticCheck[]> {
  const { rows } = await optional(
    db.select<Row>("run_diagnostics", {
      select: "check_id,category,title,status,detail,value,evidence,method,diagnosed_at",
      run_id: `eq.${runId}`,
      question_id: `eq.${questionId}`,
      limit: "500",
    }),
    { rows: [] as Row[], count: null },
  );
  const rank = (status: string) => {
    const i = (DIAGNOSTIC_STATUSES as readonly string[]).indexOf(status);
    return i < 0 ? 2 : i; // an unknown status sorts with "info"
  };
  return rows
    .map((r) => ({
      checkId: String(r.check_id),
      category: r.category ?? String(r.check_id).split(".")[0] ?? "other",
      title: r.title ?? String(r.check_id),
      status: r.status ?? "info",
      detail: r.detail ?? "",
      value: r.value ?? null,
      evidence: Array.isArray(r.evidence) ? r.evidence.map(String) : [],
      method: r.method ?? "code",
      diagnosedAt: r.diagnosed_at ?? null,
    }))
    .sort((a, b) => rank(a.status) - rank(b.status) || a.category.localeCompare(b.category) || a.checkId.localeCompare(b.checkId));
}

export async function listLibrary(db: Supabase): Promise<LibraryItem[]> {
  const [library, finals, diagnostics] = await Promise.all([
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
        "range:raw->question_details->scaling->continuous_range,unit:raw->question_details->unit," +
        "tournaments:raw->tournaments,cli_tournaments:raw->provenance->cli->tournaments",
      limit: "500",
    }),
    listDiagnosticSummaries(db),
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
      competitions: competitionsOf(extra),
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
      diagnostics: diagnostics.get(`${r.run_id}|${r.question_id}`) ?? null,
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
  const used: { index: number; model: string; value: Row }[] = [];
  let next = 0;
  const runs: RunEntry[] = (raw.extra?.ensemble ?? []).map((e: Row, i: number) => {
    const dropped = !!e.dropped;
    const value = dropped ? null : values[next++];
    if (!dropped && value) used.push({ index: i + 1, model: e.model ?? "unknown", value: value as Row });
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
      error: typeof e.error === "string" && e.error.trim() ? e.error.trim() : null,
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

  const curves = buildCurves(type, raw, range, used);
  const o = outcome.rows[0] ?? {};
  return {
    runId: row.run_id,
    questionId: row.question_id,
    postId: row.post_id,
    title: row.title ?? qd.title ?? `Question ${row.question_id}`,
    competitions: competitionsOf({ tournaments: raw.tournaments, cli_tournaments: raw.provenance?.cli?.tournaments }),
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
    curves,
    spread: buildSpread(type, used, curves),
    runs,
    tiebreakerUsed: !!raw.extra?.tiebreaker_used,
    postedComment: typeof raw.posted_comment === "string" && raw.posted_comment.trim() ? raw.posted_comment : null,
    qwenOutage: typeof raw.qwen_outage === "string" && raw.qwen_outage.trim() ? raw.qwen_outage : null,
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

/**
 * The chart data for a numeric/discrete forecast: the submitted CDF exactly as
 * stored, plus each used run's spec re-rendered on the same grid. A run whose
 * spec will not render is left out with a note — never a failed page.
 */
function buildCurves(
  type: string,
  raw: Row,
  range: number[] | null,
  used: { index: number; model: string; value: Row }[],
): Curves | null {
  if (type !== "numeric" && type !== "discrete") return null;
  const final = raw.final_forecast;
  if (!Array.isArray(range) || !Array.isArray(final) || final.length !== range.length) return null;

  const qd: Row = raw.question_details ?? {};
  const notes: string[] = [];
  const series: Curves["series"] = [
    { id: "submitted", label: "Submitted", kind: "submitted", cdf: final.map(Number) },
  ];
  for (const run of used) {
    try {
      series.push({
        id: `run-${run.index}`,
        label: run.model,
        kind: "run",
        runIndex: run.index,
        cdf: specCdf(run.value.spec, range),
      });
    } catch (error) {
      notes.push(`Run ${run.index} (${run.model}) not drawn: ${error instanceof Error ? error.message : error}`);
    }
  }

  return {
    x: range,
    discrete: type === "discrete",
    lowerOpen: !!(qd.open_lower_bound ?? qd.scaling?.open_lower_bound),
    upperOpen: !!(qd.open_upper_bound ?? qd.scaling?.open_upper_bound),
    series,
    notes,
  };
}

/** Where each used run landed, for the at-a-glance model spread. */
function buildSpread(
  type: string,
  used: { index: number; value: Row }[],
  curves: Curves | null,
): Spread | null {
  if (!used.length) return null;
  if (type === "binary") {
    const points = used
      .filter((r) => typeof r.value === "number")
      .map((r) => ({ runIndex: r.index, p: r.value as unknown as number }));
    return points.length ? { kind: "binary", points } : null;
  }
  if (type === "multiple_choice") {
    const options: Record<string, { runIndex: number; p: number }[]> = {};
    for (const r of used) {
      for (const [option, p] of Object.entries(r.value)) {
        if (typeof p === "number") (options[option] ??= []).push({ runIndex: r.index, p });
      }
    }
    return Object.keys(options).length ? { kind: "mc", options } : null;
  }
  if (curves) {
    const medians = curves.series
      .filter((s) => s.kind === "run")
      .map((s) => {
        const median = summarizeCdf(s.cdf, curves.x, [0.5])?.quantiles[0];
        return { runIndex: s.runIndex!, value: median?.value ?? null, side: median?.side };
      });
    return medians.length ? { kind: "distribution", medians } : null;
  }
  return null;
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

const TOURNAMENT_TTL_MS = 24 * 60 * 60_000; // membership does not change
const tournamentCache = new Map<number, { at: number; value: Competition[] }>();

/**
 * A post's tournaments, for rows published before the bot recorded them.
 * Shares `getLive`'s per-instance 3s spacing; the client calls this one post
 * at a time and keeps the answer in localStorage, so each question is asked
 * about once per browser.
 */
export async function getTournaments(token: string, postId: number): Promise<Competition[]> {
  const cached = tournamentCache.get(postId);
  if (cached && Date.now() - cached.at < TOURNAMENT_TTL_MS) return cached.value;

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
  const entries: Row[] = Array.isArray(post.projects?.tournament) ? post.projects.tournament : [];
  const value = entries
    .filter((t) => t && (t.slug || t.name))
    .map((t) => ({ slug: String(t.slug ?? t.name), name: t.name ?? null }));
  tournamentCache.set(postId, { at: Date.now(), value });
  return value;
}
