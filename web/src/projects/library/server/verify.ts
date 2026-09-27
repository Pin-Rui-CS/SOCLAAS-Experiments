/**
 * Checks FORECAST-LIBRARY-HANDOFF.md against the live library. Read-only.
 *
 *   npm run test:library
 *
 * Each check names the section of the handoff it tests. The handoff was written
 * by the producer; this is the consumer finding out which parts are true.
 *
 * A claim ending in `*` tests a CORRECTED rule: the handoff says otherwise and
 * was measured wrong on 2026-09-27. The comment above each says what it said.
 *
 * Credentials, all from the environment, never from a file in this repo:
 *
 *   SUPABASE_URL                       required
 *   SUPABASE_ANON_KEY                  the publishable key — enables the §1 RLS checks
 *   SUPABASE_READER_EMAIL / _PASSWORD  the owner — the path the site itself uses
 *   SUPABASE_SERVICE_KEY               optional, bypasses RLS; for a verification
 *                                      run only, and only ever exported in a shell
 *   METACULUS_TOKEN                    optional, enables the §6 authenticated check
 *
 * Data is read as the signed-in owner when those are set, else with the service
 * key. At least one of the two is needed.
 *
 * Runs under plain Node (type stripping), hence the `.ts` import extension.
 */

import { BUCKET, Supabase, SupabaseError, gunzip } from "./supabase.ts";

type Status = "PASS" | "FAIL" | "WARN" | "SKIP" | "INFO";
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const results: { section: string; claim: string; status: Status; detail: string }[] = [];

function record(section: string, claim: string, status: Status, detail = "") {
  results.push({ section, claim, status, detail });
  const colour = { PASS: 32, FAIL: 31, WARN: 33, SKIP: 90, INFO: 36 }[status];
  console.log(`\x1b[${colour}m${status.padEnd(4)}\x1b[0m ${section.padEnd(4)} ${claim}`);
  if (detail) console.log(`          ${detail.replace(/\n/g, "\n          ")}`);
}

/** Run one check; an exception is a FAIL with its message, never a crash. */
async function check(section: string, claim: string, body: () => Promise<[Status, string?]>) {
  try {
    const [status, detail] = await body();
    record(section, claim, status, detail);
  } catch (error) {
    record(section, claim, "FAIL", error instanceof Error ? error.message : String(error));
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const close = (a: number, b: number, tolerance = 1e-6) => Math.abs(a - b) <= tolerance;

// ---------------------------------------------------------------------------

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const email = process.env.SUPABASE_READER_EMAIL;
const password = process.env.SUPABASE_READER_PASSWORD;
const serviceKey = process.env.SUPABASE_SERVICE_KEY;
const metaculusToken = process.env.METACULUS_TOKEN;

if (!url) {
  console.error("SUPABASE_URL is not set. See the header of this file.");
  process.exit(2);
}

const owner =
  anonKey && email && password
    ? new Supabase({ kind: "user", url, anonKey, email, password })
    : null;
const service = serviceKey ? new Supabase({ kind: "service", url, serviceKey }) : null;
const db = owner ?? service;

if (!db) {
  console.error(
    "Need SUPABASE_ANON_KEY + SUPABASE_READER_EMAIL + SUPABASE_READER_PASSWORD, " +
      "or SUPABASE_SERVICE_KEY.",
  );
  process.exit(2);
}

console.log(`Reading as: ${db.kind === "user" ? "signed-in owner" : "service key (bypasses RLS)"}\n`);

const TABLES = ["runs", "forecasts", "llm_calls", "outcomes", "scores"];
const VIEWS = [
  "forecast_library",
  "accuracy_by_model",
  "cost_by_week",
  "questions_to_check",
  "forecasts_to_score",
];

// --- §1 Connecting ----------------------------------------------------------

await check("§1", "project is reachable (not paused)", async () => {
  const response = await fetch(`${url}/auth/v1/health`, {
    headers: anonKey ? { apikey: anonKey } : serviceKey ? { apikey: serviceKey } : {},
  });
  return response.ok
    ? ["PASS", `auth health ${response.status}`]
    : ["FAIL", `auth health ${response.status}: ${(await response.text()).slice(0, 120)}`];
});

await check("§1", "no key at all is refused", async () => {
  const response = await fetch(`${url}/rest/v1/forecasts?select=run_id&limit=1`);
  return response.status === 401
    ? ["PASS", "401 without apikey"]
    : ["FAIL", `expected 401, got ${response.status}`];
});

await check("§1", "anon key alone reads nothing from any table or view", async () => {
  if (!anonKey) return ["SKIP", "set SUPABASE_ANON_KEY to test"];
  const anon = new Supabase({ kind: "anon", url, anonKey });
  const leaks: string[] = [];
  for (const relation of [...TABLES, ...VIEWS]) {
    try {
      const { rows } = await anon.select(relation, { select: "*", limit: "1" });
      if (rows.length) leaks.push(`${relation} returned rows`);
    } catch (error) {
      // 401/403 "permission denied" is the documented outcome: privileges revoked.
      if (!(error instanceof SupabaseError) || ![401, 403].includes(error.status)) throw error;
    }
  }
  return leaks.length ? ["FAIL", leaks.join("; ")] : ["PASS", "every relation refused or empty"];
});

await check("§1", "owner sign-in works and unlocks rows", async () => {
  if (!owner) return ["SKIP", "set SUPABASE_ANON_KEY + SUPABASE_READER_EMAIL/_PASSWORD to test"];
  const { rows } = await owner.select("forecasts", { select: "run_id", limit: "1" });
  return rows.length ? ["PASS"] : ["WARN", "signed in, but forecasts returned 0 rows"];
});

// --- §2 Schema --------------------------------------------------------------

const counts: Record<string, number | null> = {};
for (const relation of [...TABLES, ...VIEWS]) {
  await check("§2", `${relation} is readable`, async () => {
    const { count } = await db.select(relation, { select: "*", limit: "1" }, { count: true });
    counts[relation] = count;
    return ["PASS", `${count} rows`];
  });
}

const FORECAST_COLUMNS =
  "run_id,question_id,post_id,question_type,title,run_at,workflow,submitted,abstained," +
  "total_cost_usd,estimated_tokens,tier1_model,tier2_model,code_sha,schema_version,run_url," +
  "blob_prefix,raw,published_at";

// Everything else reads from here. The library is small; if it outgrows one
// request, page this with `offset`.
const { rows: forecasts } = await db.select<Row>("forecasts", {
  select: FORECAST_COLUMNS,
  order: "run_at.desc.nullslast",
  limit: "1000",
});
const { rows: runs } = await db.select<Row>("runs", { select: "*", limit: "1000" });

await check("§2", "forecasts has every documented column", async () =>
  forecasts.length
    ? ["PASS", `${FORECAST_COLUMNS.split(",").length} columns selected without error`]
    : ["WARN", "selected fine, but the table is empty"],
);

await check("§2", "run_id is gh-<id>-<attempt> or local-<ts>-<host>", async () => {
  const bad = runs.map((r) => r.run_id).filter((id) => !/^(gh-\d+-\d+|local-.+-.+)$/.test(id));
  return bad.length ? ["FAIL", `off-format: ${bad.slice(0, 5).join(", ")}`] : ["PASS", `${runs.length} runs`];
});

await check("§2", "runs.event ∈ {schedule, workflow_dispatch, local}", async () => {
  const seen = new Set(runs.map((r) => r.event));
  const extra = [...seen].filter((e) => !["schedule", "workflow_dispatch", "local"].includes(e));
  return extra.length ? ["FAIL", `also: ${extra.join(", ")}`] : ["PASS", [...seen].join(", ")];
});

// CORRECTS §2: the handoff lists three types. `discrete` exists too (45707);
// it is shaped like numeric — distribution run_values, a CDF final_forecast —
// and eval_tools/score_forecasts.py scores it with CRPS.
await check("§2", "question_type ∈ {binary, multiple_choice, numeric, discrete*}", async () => {
  const seen = new Set(forecasts.map((f) => f.question_type));
  const extra = [...seen].filter(
    (t) => !["binary", "multiple_choice", "numeric", "discrete"].includes(t),
  );
  return extra.length ? ["FAIL", `also: ${extra.join(", ")}`] : ["PASS", [...seen].join(", ")];
});

await check("§2", "promoted columns agree with raw", async () => {
  const mismatches: string[] = [];
  for (const f of forecasts) {
    const raw = f.raw ?? {};
    for (const key of ["question_id", "post_id", "question_type", "title"]) {
      if (raw[key] !== undefined && String(raw[key]) !== String(f[key])) {
        mismatches.push(`${f.run_id}/${f.question_id}.${key}: column=${f[key]} raw=${raw[key]}`);
      }
    }
    if ((raw.schema_version ?? 1) !== f.schema_version) {
      mismatches.push(`${f.run_id}/${f.question_id}.schema_version`);
    }
  }
  return mismatches.length
    ? ["FAIL", mismatches.slice(0, 5).join("\n")]
    : ["PASS", `${forecasts.length} rows`];
});

await check("§2", "forecast_library.probability_yes is set only for binary", async () => {
  const { rows } = await db.select<Row>("forecast_library", {
    select: "question_type,probability_yes,abstained",
    limit: "1000",
  });
  const nonBinary = rows.filter((r) => r.question_type !== "binary" && r.probability_yes != null);
  const binaryMissing = rows.filter(
    (r) => r.question_type === "binary" && !r.abstained && r.probability_yes == null,
  );
  if (nonBinary.length) return ["FAIL", `${nonBinary.length} non-binary rows carry it`];
  return binaryMissing.length
    ? ["WARN", `${binaryMissing.length} non-abstained binary rows have none`]
    : ["PASS", `${rows.filter((r) => r.probability_yes != null).length} binary rows carry it`];
});

await check("§2", "scores.metric is brier for binary/MC, crps for numeric", async () => {
  const { rows } = await db.select<Row>("forecast_library", {
    select: "question_type,metric,score",
    metric: "not.is.null",
    limit: "1000",
  });
  if (!rows.length) return ["SKIP", "no scores yet"];
  const continuous = (t: string) => t === "numeric" || t === "discrete";
  const wrong = rows.filter(
    (r) => r.metric !== (continuous(r.question_type) ? "crps" : "brier"),
  );
  return wrong.length ? ["FAIL", `${wrong.length} mismatched`] : ["PASS", `${rows.length} scores`];
});

// --- §3 The raw contract ----------------------------------------------------

const v2 = forecasts.filter((f) => f.schema_version === 2);
const live = v2.filter((f) => !f.abstained);

await check("§3", "schema_version is 1 or 2", async () => {
  const tally: Record<string, number> = {};
  for (const f of forecasts) tally[f.schema_version] = (tally[f.schema_version] ?? 0) + 1;
  const unknown = Object.keys(tally).filter((v) => v !== "1" && v !== "2");
  return unknown.length
    ? ["FAIL", `unknown versions ${unknown.join(", ")}`]
    : ["PASS", Object.entries(tally).map(([v, n]) => `v${v}: ${n}`).join(", ")];
});

await check("§3", "v2 raw has every documented top-level key", async () => {
  if (!v2.length) return ["SKIP", "no v2 rows"];
  const expected = [
    "schema_version", "question_id", "post_id", "title", "question_type", "run_timestamp",
    "provenance", "question_details", "artifact_check", "degraded_search_providers",
    "run_values", "final_forecast", "forecast_payload", "extra", "estimated_tokens",
    "total_cost_usd", "timings", "usage_yaml_table", "llm_calls", "abstained", "submitted",
  ];
  const missing: Record<string, number> = {};
  for (const f of v2) for (const k of expected) if (!(k in f.raw)) missing[k] = (missing[k] ?? 0) + 1;
  const undocumented = new Set<string>();
  for (const f of v2) for (const k of Object.keys(f.raw)) if (!expected.includes(k)) undocumented.add(k);

  const parts = [];
  if (Object.keys(missing).length) {
    parts.push(`missing: ${Object.entries(missing).map(([k, n]) => `${k} (${n}/${v2.length})`).join(", ")}`);
  }
  if (undocumented.size) parts.push(`undocumented: ${[...undocumented].join(", ")}`);
  return [Object.keys(missing).length ? "WARN" : "PASS", parts.join("\n") || `${v2.length} rows`];
});

// CORRECTS §3: ensemble is NOT always parallel to run_values. A run the
// forecaster rejects stays in ensemble with `dropped: true` (possibly still
// `valid: true`) but is left out of run_values — 45412, where gpt-5.6-sol was
// dropped as self-contradictory. Filter out dropped entries, then zip.
await check("§3", "extra.ensemble minus dropped is parallel to run_values*", async () => {
  if (!live.length) return ["SKIP", "no non-abstained v2 rows"];
  const kept = (f: Row) => (f.raw.extra?.ensemble ?? []).filter((e: Row) => !e.dropped);
  const bad = live.filter((f) => kept(f).length !== (f.raw.run_values?.length ?? -1));
  const withDrops = live.filter((f) => kept(f).length !== (f.raw.extra?.ensemble?.length ?? 0));
  return bad.length
    ? ["FAIL", bad.slice(0, 5).map((f) =>
        `${f.run_id}/${f.question_id}: kept ${kept(f).length}, run_values ${f.raw.run_values?.length}`,
      ).join("\n")]
    : ["PASS", `${live.length} rows; with a dropped run: ${withDrops.map((f) => f.question_id).join(", ") || "none"}`];
});

await check("§3", "run_values shape matches question_type", async () => {
  const bad: string[] = [];
  for (const f of live) {
    for (const value of f.raw.run_values ?? []) {
      const ok =
        f.question_type === "binary" ? typeof value === "number"
        : f.question_type === "multiple_choice" ? value && typeof value === "object" && !Array.isArray(value)
        : value && typeof value === "object";
      if (!ok) { bad.push(`${f.run_id}/${f.question_id} (${f.question_type}): ${JSON.stringify(value).slice(0, 60)}`); break; }
    }
  }
  return bad.length ? ["FAIL", bad.slice(0, 5).join("\n")] : ["PASS"];
});

await check("§3", "numeric run_value shape (the handoff leaves it unspecified)", async () => {
  const numeric = live.find((f) => f.question_type === "numeric" && f.raw.run_values?.length);
  if (!numeric) return ["SKIP", "no numeric rows"];
  const sample = numeric.raw.run_values[0];
  return ["INFO", `keys: ${Object.keys(sample).join(", ")}; forecast_payload.continuous_cdf length: ${numeric.raw.forecast_payload?.continuous_cdf?.length ?? "none"}`];
});

await check("§3", "forecast_payload has the three documented keys", async () => {
  const bad = live.filter(
    (f) => !["probability_yes", "probability_yes_per_category", "continuous_cdf"].every(
      (k) => k in (f.raw.forecast_payload ?? {}),
    ),
  );
  return bad.length
    ? ["WARN", `${bad.length}/${live.length} lack some; e.g. keys ${Object.keys(bad[0].raw.forecast_payload ?? {}).join(",") || "(none)"}`]
    : ["PASS", `${live.length} rows`];
});

// The handoff never says how runs are aggregated, and its worked example is a
// plain mean. That holds for multiple choice only: binary takes the MEDIAN
// (forecasters/binary.py, `np.median`) — 45608 ran 0.09/0.11/0.12 and
// submitted 0.11, not 0.1067.
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

await check("§3", "final_forecast: binary = median*, multiple choice = mean", async () => {
  const bad: string[] = [];
  let checked = 0;
  for (const f of live) {
    const values = f.raw.run_values ?? [];
    const final = f.raw.final_forecast;
    if (!values.length || final == null) continue;
    if (f.question_type === "binary") {
      checked++;
      if (!close(median(values), final, 1e-3)) bad.push(`${f.question_id}: median ${median(values)} vs final ${final}`);
    } else if (f.question_type === "multiple_choice") {
      checked++;
      const ok = Object.keys(final).every((option) =>
        close(values.reduce((a: number, v: Row) => a + (v[option] ?? 0), 0) / values.length, final[option], 1e-3),
      );
      if (!ok) bad.push(`${f.question_id} (MC): not the mean`);
    }
  }
  if (!checked) return ["SKIP", "no binary/MC rows"];
  return bad.length ? ["FAIL", bad.slice(0, 5).join("\n")] : ["PASS", `${checked} rows`];
});

// CORRECTS §3: "final_forecast … same shape as one run_value" is false for
// numeric and discrete. run_values are mixture specs; final_forecast is the
// submitted CDF — an array, identical to forecast_payload.continuous_cdf.
await check("§3", "numeric/discrete final_forecast is the CDF array*", async () => {
  const rows = live.filter((f) => f.question_type === "numeric" || f.question_type === "discrete");
  if (!rows.length) return ["SKIP", "no numeric/discrete rows"];
  const bad = rows.filter((f) =>
    !Array.isArray(f.raw.final_forecast) ||
    JSON.stringify(f.raw.final_forecast) !== JSON.stringify(f.raw.forecast_payload?.continuous_cdf),
  );
  return bad.length
    ? ["FAIL", `${bad.length}/${rows.length} differ from continuous_cdf`]
    : ["PASS", `${rows.length} rows, ${rows[0].raw.final_forecast.length} points`];
});

await check("§3", "worked example — question 45859 on 2026-09-24", async () => {
  const hit = forecasts.find(
    (f) => f.question_id === 45859 && String(f.run_at ?? f.raw.run_timestamp).startsWith("2026-09-24"),
  ) ?? forecasts.find((f) => f.question_id === 45859);
  if (!hit) return ["FAIL", "no row for question 45859"];
  const models = (hit.raw.extra?.ensemble ?? []).map((e: Row) => e.model);
  const final = hit.raw.final_forecast ?? {};
  const expected: Record<string, number> = { Likud: 0.3575, Yashar: 0.58, Other: 0.0625 };
  const matches = Object.entries(expected).every(([k, v]) => {
    const key = Object.keys(final).find((option) => option.startsWith(k));
    return key !== undefined && close(final[key], v, 1e-3);
  });
  return [
    matches ? "PASS" : "FAIL",
    `run ${hit.run_id} at ${hit.run_at}\nensemble: ${models.join(", ")}\nfinal: ${JSON.stringify(final)}`,
  ];
});

await check("§3", "raw.llm_calls matches the llm_calls table row count", async () => {
  const sample = v2.slice(0, 20);
  const bad: string[] = [];
  for (const f of sample) {
    const { count } = await db.select("llm_calls", {
      select: "call_no",
      run_id: `eq.${f.run_id}`,
      question_id: `eq.${f.question_id}`,
      limit: "1",
    }, { count: true });
    const inRaw = f.raw.llm_calls?.length ?? 0;
    if (count !== inRaw) bad.push(`${f.run_id}/${f.question_id}: raw ${inRaw}, table ${count}`);
  }
  return bad.length ? ["FAIL", bad.slice(0, 5).join("\n")] : ["PASS", `${sample.length} rows sampled`];
});

// --- §4 Storage -------------------------------------------------------------

await check("§4", "blob_prefix is runs/<run_id>/<question_id>", async () => {
  const bad = forecasts.filter((f) => f.blob_prefix !== `runs/${f.run_id}/${f.question_id}`);
  return bad.length
    ? ["FAIL", bad.slice(0, 5).map((f) => f.blob_prefix).join("\n")]
    : ["PASS", `${forecasts.length} rows`];
});

const FILES = ["forecast.json", "research.md.gz", "runs.md.gz", "audit.md.gz", "evolution.md.gz", "trace.tar.gz"];

await check("§4", "every row's files exist (rows written after uploads)", async () => {
  const presence: Record<string, number> = Object.fromEntries(FILES.map((f) => [f, 0]));
  const noJson: string[] = [];
  const undocumented = new Set<string>();
  for (const f of forecasts) {
    const names = (await db.list(`${f.blob_prefix}/`)).map((o) => o.name);
    for (const name of names) {
      if (name in presence) presence[name]++;
      else undocumented.add(name);
    }
    if (!names.includes("forecast.json")) noJson.push(f.blob_prefix);
  }
  const summary = FILES.map((f) => `${f} ${presence[f]}/${forecasts.length}`).join(", ") +
    (undocumented.size ? `\nundocumented: ${[...undocumented].join(", ")}` : "");
  return noJson.length
    ? ["FAIL", `no forecast.json under ${noJson.length} prefixes, e.g. ${noJson[0]}\n${summary}`]
    : ["PASS", summary];
});

const sampleRow = live.find((f) => f.raw.run_values?.length) ?? forecasts[0];

await check("§4", "forecast.json in storage equals the raw column", async () => {
  if (!sampleRow) return ["SKIP", "no rows"];
  const bytes = await db.download(`${sampleRow.blob_prefix}/forecast.json`);
  if (!bytes) return ["FAIL", "forecast.json missing"];
  const stored = JSON.parse(new TextDecoder().decode(bytes));
  const same = JSON.stringify(stored) === JSON.stringify(sampleRow.raw);
  // jsonb reorders keys, so compare canonically before calling it a mismatch.
  const canonical = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(canonical)
    : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical((v as Row)[k])]))
    : v;
  const sameCanonical = JSON.stringify(canonical(stored)) === JSON.stringify(canonical(sampleRow.raw));
  return same || sameCanonical
    ? ["PASS", `${sampleRow.blob_prefix}${same ? "" : " (equal after key sort)"}`]
    : ["FAIL", `${sampleRow.blob_prefix}: content differs`];
});

await check("§4", ".gz files are gzip and carry the documented headings", async () => {
  if (!sampleRow) return ["SKIP", "no rows"];
  const notes: string[] = [];
  let failed = false;
  const expectations: Record<string, string[]> = {
    "research.md.gz": ["## Compiled Brief (sent to forecaster)", "## Provider:"],
    "runs.md.gz": ["## Prompt (identical for every run)", "## Run 1"],
    "audit.md.gz": [],
    "evolution.md.gz": [],
  };
  for (const [file, headings] of Object.entries(expectations)) {
    const bytes = await db.download(`${sampleRow.blob_prefix}/${file}`);
    if (!bytes) { notes.push(`${file}: absent`); continue; }
    if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) { failed = true; notes.push(`${file}: not gzip`); continue; }
    const text = await gunzip(bytes);
    const missing = headings.filter((h) => !text.includes(h));
    if (missing.length) failed = true;
    notes.push(`${file}: ${text.length} chars${missing.length ? `, missing ${missing.join(" / ")}` : ""}`);
  }
  return [failed ? "FAIL" : "PASS", `${sampleRow.blob_prefix}\n${notes.join("\n")}`];
});

await check("§4", "a missing file reads as not-found", async () => {
  if (!sampleRow) return ["SKIP", "no rows"];
  const bytes = await db.download(`${sampleRow.blob_prefix}/does-not-exist.md.gz`);
  return bytes === null ? ["PASS"] : ["FAIL", "got bytes for a nonexistent path"];
});

await check("§1", "bucket is private (public URL refused)", async () => {
  if (!sampleRow) return ["SKIP", "no rows"];
  const response = await fetch(
    `${url}/storage/v1/object/public/${BUCKET}/${sampleRow.blob_prefix}/forecast.json`,
  );
  return response.ok
    ? ["FAIL", "public URL served the file"]
    : ["PASS", `public URL → ${response.status}`];
});

// --- §5 Gotchas -------------------------------------------------------------

await check("§5.1", "routing.forecaster_pool disagrees with extra.ensemble", async () => {
  let agree = 0, disagree = 0;
  const examples: string[] = [];
  for (const f of live) {
    const pool: string[] = f.raw.provenance?.routing?.forecaster_pool ?? [];
    const used: string[] = (f.raw.extra?.ensemble ?? []).map((e: Row) => e.model);
    if (!pool.length || !used.length) continue;
    const usedSet = [...new Set(used)].sort().join(",");
    if ([...new Set(pool)].sort().join(",") === usedSet) agree++;
    else { disagree++; examples.push(`${f.question_id}: pool [${pool.join(", ")}] vs used [${used.join(", ")}]`); }
  }
  if (!agree && !disagree) return ["SKIP", "no rows with both"];
  // The handoff claims the pool is unreliable. Disagreement confirms it.
  return [disagree ? "PASS" : "WARN", `agree ${agree}, disagree ${disagree}\n${examples.slice(0, 3).join("\n")}`];
});

await check("§5.2", "cost_source ∈ {native, price_table, quota}; quota rows cost $0", async () => {
  const { rows } = await db.select<Row>("llm_calls", {
    select: "cost_source,cost_usd,quota_microdollars",
    limit: "10000",
  });
  const tally: Record<string, { n: number; usd: number; quota: number }> = {};
  for (const r of rows) {
    const t = (tally[r.cost_source ?? "null"] ??= { n: 0, usd: 0, quota: 0 });
    t.n++; t.usd += Number(r.cost_usd ?? 0); t.quota += Number(r.quota_microdollars ?? 0);
  }
  const unknown = Object.keys(tally).filter((s) => !["native", "price_table", "quota"].includes(s));
  const quotaWithDollars = rows.filter((r) => r.cost_source === "quota" && Number(r.cost_usd) !== 0);
  const summary = Object.entries(tally)
    .map(([s, t]) => `${s}: ${t.n} calls, $${t.usd.toFixed(4)}, quota ${t.quota.toFixed(0)}µ$`)
    .join("\n");
  const status: Status = unknown.length || quotaWithDollars.length ? "FAIL" : "PASS";
  return [status, summary + (quotaWithDollars.length ? `\n${quotaWithDollars.length} quota rows have cost_usd ≠ 0` : "")];
});

await check("§5.3", "question_id and post_id differ", async () => {
  const same = forecasts.filter((f) => f.post_id != null && f.post_id === f.question_id);
  return same.length
    ? ["WARN", `${same.length} rows where they're equal`]
    : ["PASS", `${new Set(forecasts.map((f) => f.question_id)).size} questions`];
});

await check("§5.4", "not every row is a submission", async () => {
  const submitted = forecasts.filter((f) => f.submitted).length;
  const abstained = forecasts.filter((f) => f.abstained).length;
  const workflows = [...new Set(forecasts.map((f) => f.workflow))].join(", ");
  return ["INFO", `${submitted} submitted, ${abstained} abstained, ${forecasts.length} total\nworkflows: ${workflows}`];
});

await check("§5.4", "abstained rows carry no forecast", async () => {
  const bad = forecasts.filter((f) => f.abstained && f.raw.final_forecast != null);
  return bad.length ? ["WARN", `${bad.length} abstained rows still have final_forecast`] : ["PASS"];
});

await check("§5.5", "v1 rows lack provenance", async () => {
  const v1 = forecasts.filter((f) => f.schema_version === 1);
  if (!v1.length) return ["SKIP", "no v1 rows"];
  const withProvenance = v1.filter((f) => f.raw.provenance);
  return withProvenance.length
    ? ["WARN", `${withProvenance.length}/${v1.length} v1 rows have provenance`]
    : ["PASS", `${v1.length} v1 rows`];
});

// --- §7 Current state -------------------------------------------------------

await check("§7", "freshness — newest forecast and recent runs", async () => {
  const newest = forecasts[0]?.run_at;
  const perRun = new Map<string, { workflow: string; n: number; submitted: number; at: string }>();
  for (const f of forecasts) {
    const r = perRun.get(f.run_id) ?? { workflow: f.workflow, n: 0, submitted: 0, at: f.run_at };
    r.n++; if (f.submitted) r.submitted++;
    perRun.set(f.run_id, r);
  }
  const recent = [...perRun.entries()].slice(0, 8)
    .map(([id, r]) => `${r.at?.slice(0, 16)}  ${id}  ${r.workflow}  ${r.n}q ${r.submitted} submitted`);
  return ["INFO", `${forecasts.length} forecasts, ${runs.length} runs, newest ${newest}\n${recent.join("\n")}`];
});

await check("§7", "question 45809 is still missing (open item)", async () => {
  const rows = forecasts.filter((f) => f.question_id === 45809);
  return rows.length
    ? ["INFO", `now present: ${rows.map((f) => f.run_id).join(", ")} — the open item may be done`]
    : ["INFO", "still absent — needs the backfill workflow"];
});

await check("§7", "daily scoring job is running", async () => {
  const { rows } = await db.select<Row>("outcomes", {
    select: "checked_at",
    order: "checked_at.desc",
    limit: "1",
  });
  if (!rows.length) return ["WARN", "outcomes is empty"];
  const hours = (Date.now() - Date.parse(rows[0].checked_at)) / 3_600_000;
  return [hours < 36 ? "PASS" : "WARN", `last check ${rows[0].checked_at} (${hours.toFixed(1)}h ago)`];
});

// --- §6 Metaculus -----------------------------------------------------------

const probe = forecasts.find((f) => f.post_id) ?? null;

// CORRECTS §6: "public question reads generally work without one" is false.
// Metaculus answers 403 "The API is only available to authenticated users" —
// measured again here, and first recorded in apiagent's Metaculus adapter on
// 2026-09-06. The reader needs METACULUS_TOKEN, server-side.
await check("§6", "unauthenticated reads are refused*", async () => {
  if (!probe) return ["SKIP", "no row with a post_id"];
  const response = await fetch(`https://www.metaculus.com/api/questions/${probe.question_id}/`);
  return response.status === 403
    ? ["PASS", `GET /questions/${probe.question_id}/ → 403 without a token`]
    : ["FAIL", `expected 403, got ${response.status} — Metaculus may have reopened public reads`];
});

await check("§6", "authenticated reads; question vs post endpoints", async () => {
  if (!probe) return ["SKIP", "no row with a post_id"];
  if (!metaculusToken) return ["SKIP", "set METACULUS_TOKEN to test"];
  const headers = { Authorization: `Token ${metaculusToken}` };
  const notes: string[] = [];

  await sleep(3000); // §6: space requests by about 3 seconds
  const q = await fetch(`https://www.metaculus.com/api/questions/${probe.question_id}/`, { headers });
  const qBody = q.ok ? await q.json() : null;
  const question = qBody?.question ?? qBody;
  notes.push(`/questions/${probe.question_id}/ → ${q.status}${qBody?.question ? " (nested under .question)" : ""}; title matches: ${question?.title === probe.title}`);

  await sleep(3000);
  const p = await fetch(`https://www.metaculus.com/api/posts/${probe.post_id}/`, { headers });
  const pBody = p.ok ? await p.json() : null;
  notes.push(`/posts/${probe.post_id}/ → ${p.status}; post.question.id = ${pBody?.question?.id} (expect ${probe.question_id})`);

  const ok = q.ok && p.ok && pBody?.question?.id === probe.question_id;
  return [ok ? "PASS" : "FAIL", notes.join("\n")];
});

// ---------------------------------------------------------------------------

const tally = results.reduce<Record<string, number>>((t, r) => ((t[r.status] = (t[r.status] ?? 0) + 1), t), {});
console.log(`\n${Object.entries(tally).map(([s, n]) => `${n} ${s}`).join(", ")}`);
process.exit(tally.FAIL ? 1 : 0);
