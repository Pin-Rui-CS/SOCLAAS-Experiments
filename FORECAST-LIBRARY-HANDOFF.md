# Forecast library — handoff for the reader/website repo

This document describes a database that already exists and is already being written to.
It is written for whoever builds the **separate repo** that *reads* the library. That repo
writes nothing to the database and contains no forecasting code.

- **Producer:** the forecasting bot repo (`Pirohuni-Forecast-Bot-Fall`). It runs on GitHub
  Actions, forecasts Metaculus questions, and publishes each run to Supabase.
- **Consumer (you):** reads Supabase for everything the bot recorded, and calls the
  **Metaculus API** directly for anything live that the bot never stored (current community
  prediction, question status right now, full option lists, etc.).
- **You never need the bot's code to read the library.** Everything the reader needs is the
  Postgres schema, the `raw` JSON contract, and the storage layout — all below.

---

## 1. Connecting

Two Supabase credentials exist and they are **not interchangeable**:

| Key | Who holds it | What it can do |
|---|---|---|
| anon / publishable key | the website, in the browser | **nothing on its own** — all privileges are revoked from `anon` |
| `SUPABASE_SERVICE_KEY` (secret, `sb_secret_…`) | GitHub Actions secrets + the bot's local `.env` | full read/write, bypasses row-level security |

**The service key must never appear in the reader repo, its build output, or any env var that
reaches a browser.** The library is private by design.

Reads work like this: row-level security grants `select` to the `authenticated` role only, and
sign-ups are turned off in Supabase Auth, so exactly one user (the owner) exists. The website
ships the anon key, the owner signs in, and the session token is what actually unlocks the rows.
Use the normal `@supabase/supabase-js` client with the anon key plus `signInWithPassword`; every
table and view returns rows once signed in and zero rows before that. A server-rendered reader
may instead hold a service key server-side only, but prefer the signed-in-user path.

Storage is the same story: the `forecast-runs` bucket is **private**, with a select policy for
`authenticated`. Fetch files through short-lived signed URLs
(`storage.from('forecast-runs').createSignedUrl(path, seconds)`), not public URLs.

`SUPABASE_URL` is the project URL. PostgREST lives at `/rest/v1/<table-or-view>`; storage at
`/storage/v1/object/<bucket>/<path>`.

One operational note: this is a **free Supabase project, and free projects pause when idle.** A
daily GitHub Actions cron (`score-outcomes.yaml`, 03:17 UTC) touches it partly for that reason.
If the reader sees connection failures after a quiet period, check whether the project is paused
before debugging anything else.

---

## 2. Schema

Authoritative DDL lives in the bot repo at `db/migrations/001_schema.sql` (tables + views) and
`002_supabase_security.sql` (privileges, RLS, bucket). Both are idempotent. Summary:

### `runs` — one row per bot invocation
`run_id` (PK, text), `workflow`, `event` (`schedule` | `workflow_dispatch` | `local`),
`code_sha`, `run_url`, `run_timestamp`, `started_at`, `config` (jsonb), `published_at`.

`run_id` format: `gh-<github run id>-<attempt>` for CI, `local-<timestamp>-<host>` otherwise.
`config` holds `{routing: {...}, cli: {...}}` — see the caveat in §5.

### `forecasts` — one row per question per run  ← the main table
Primary key `(run_id, question_id)`.

`question_id`, `post_id`, `question_type` (`binary` | `multiple_choice` | `numeric`), `title`,
`run_at`, `workflow`, `submitted` (bool), `abstained` (bool), `total_cost_usd`,
`estimated_tokens`, `tier1_model`, `tier2_model`, `code_sha`, `schema_version`, `run_url`,
`blob_prefix`, **`raw` (jsonb — the entire `forecast.json`, verbatim)**, `published_at`.

Indexes on `question_id` and `run_at`.

**Design rule to respect:** `raw` is the source of truth. Columns are a *promotion* of stable
fields for indexing and filtering. Anything not promoted — the per-run forecasts, the ensemble,
the artifact check, the resolution criteria — is read out of `raw`. Stored rows are never
rewritten; when `forecast.json` changes shape, `schema_version` is bumped and readers branch.

### `llm_calls` — one row per LLM call
PK `(run_id, question_id, call_no)`, FK → `forecasts`.
`task`, `endpoint`, `cost_source`, `model`, `input_tokens`, `output_tokens`,
`native_input_tokens`, `native_output_tokens`, `reasoning_tokens`, `cached_input_tokens`,
`cache_write_tokens`, `cost_usd`, `quota_microdollars`, `duration_seconds`.

`task` is the call-site label — e.g. `evidence-plan`, `serp-url-ranking`,
`compiler/research-brief`, `mc-forecast[anthropic/claude-opus-5.5]`. This is the table for cost
and latency analysis.

### `outcomes` — one row per question, written by the daily job
`question_id` (PK), `post_id`, `status`, `resolution`, `resolved_at`, `checked_at`.

### `scores` — one row per forecast once its question resolves
PK `(run_id, question_id)`, FK → `forecasts`.
`metric` (`brier` for binary and multiple choice, `crps` for numeric), `score`
(**lower is better for both**), `resolution`, `scored_at`.

### Views (all `security_invoker = true`, so RLS applies through them)
- **`forecast_library`** — `forecasts` + `outcomes` + `scores`, left-joined. The default starting
  point. Note it exposes `probability_yes` **only for binary** questions; multiple-choice and
  numeric distributions must come from `raw`.
- **`accuracy_by_model`** — mean score grouped by `question_type`, `metric`, `tier1_model`,
  `tier2_model`, over `submitted` rows only. **See §5 — this grouping is unreliable now.**
- **`cost_by_week`** — per-week forecast count, `cost_usd`, `quota_microdollars`, tokens.
- **`questions_to_check`** — unresolved questions, stalest check first (used by the scoring job).
- **`forecasts_to_score`** — resolved questions with an unscored forecast.

---

## 3. The `raw` contract — `forecast.json`, schema_version 2

Top-level keys, with the paths a reader actually wants:

```
schema_version        2   (1 = legacy records with no provenance; branch on this)
question_id, post_id, title, question_type, run_timestamp

provenance
  run_id, code_sha, workflow, event, run_url
  routing   { mode, tier1_model, tier1_endpoint, tier2_model, tier2_endpoint,
              forecaster_pool[], heterogeneous_model }      <- unreliable, see §5
  cli       { ... }  often empty

question_details      the Metaculus question as fetched at run time:
  id, title, type, resolution_criteria, description, fine_print, options[],
  scaling{}, open_upper_bound, open_lower_bound, unit, status,
  scheduled_close_time, scheduled_resolve_time
  <- a SNAPSHOT. For current status / community prediction, call the API (§6).

artifact_check        { status: complete|partial|missing, what_was_found,
                        what_is_missing, closest_available, forecast_swing,
                        retry_queries[] }
degraded_search_providers[]

run_values[]          one entry per ensemble run, in run order.
                      multiple_choice: { "<option>": prob, ... }
                      binary: a number;  numeric: a distribution object
final_forecast        the aggregate that was submitted (same shape as one run_value)
forecast_payload      { probability_yes, probability_yes_per_category, continuous_cdf }
                      — exactly what was POSTed to Metaculus
extra.ensemble[]      [{ model, valid, repaired }, ...]  <- PARALLEL to run_values, same order.
                      The authoritative record of which model produced which run.

estimated_tokens, total_cost_usd
timings               { research_seconds, forecast_seconds, total_seconds }
usage_yaml_table      the rendered per-call table as a string (legacy; prefer llm_calls)
llm_calls[]           structured per-call records (same data as the llm_calls table)
abstained, submitted  booleans
```

Worked example — question 45859 (Israeli election, multiple choice, run 2026-09-24):
`run_values` = `[{Likud .41, Yashar .56, Other .03}, {.34/.52/.14}, {.33/.62/.05}, {.35/.62/.03}]`
and `extra.ensemble` = `[opus-5.5, gpt-5.6-sol, qwen3.8:27b, qwen3.8:27b]`. Zip them to get
"which model said what". `final_forecast` = `{Likud .3575, Yashar .58, Other .0625}`.

---

## 4. Storage layout

`forecasts.blob_prefix` = `runs/<run_id>/<question_id>`, and under it:

| Object | Encoding |
|---|---|
| `forecast.json` | plain JSON (same content as the `raw` column) |
| `research.md.gz` | gzip — the full research corpus plus the compiled brief sent to forecasters |
| `runs.md.gz` | gzip — the forecaster prompt and every run's full reasoning |
| `audit.md.gz` | gzip — token/cost table, timings |
| `evolution.md.gz` | gzip — how the forecast changed across runs |
| `trace.tar.gz` | gzip tarball of `trace/` — every scrape, prompt and intermediate artifact |

Any of these may be **absent** (an abstained or failed question may not write them all), so
treat a 404 as "not produced", not as an error. Files are uploaded *before* rows are written, so
a row never points at missing files. Uploads use `x-upsert: true`, so republishing a run
overwrites in place.

`research.md` is the interesting one for a reading UI: the compiled brief sits under
`## Compiled Brief (sent to forecaster)`, followed by `## Provider: …` sections holding the raw
research. `runs.md` has the shared prompt under `## Prompt (identical for every run)` and then
`## Run N` sections.

---

## 5. Gotchas — read these before writing queries

**1. `tier1_model` / `tier2_model` no longer identify the forecasters.** The bot used to run a
fixed pool; it now selects forecasters per run (checkboxes in the workflow) and gives one run the
raw research instead of the compiled brief. But `provenance.routing.forecaster_pool` and
`heterogeneous_model` are built from the *hardcoded profile defaults*, not from the env overrides
the workflow actually passed (`provenance.py:_routing` reads `profile.forecaster_pool`, not
`config.FORECASTER_MODELS`). In the 45859 run, routing claims a 2-model pool with Sonnet on raw
research, while the run actually used Opus 5.5, GPT-5.6 Sol, Qwen, Qwen.
→ **Attribute runs via `raw -> 'extra' -> 'ensemble'`, never via the tier columns, and treat
`accuracy_by_model` as unreliable until the bot repo fixes this.**

**2. Cost is two incompatible currencies.** `llm_calls.cost_source` is `native` (real dollars
reported by OpenRouter), `price_table` (estimated from a price list), or `quota` (SoCLaaS Qwen —
free in money, metered against an allowance). Quota rows have `cost_usd = 0` and a non-zero
`quota_microdollars`, which is **not dollars**. Summing `cost_usd` gives real spend; it does not
give "amount of compute used". Report the two separately and never add them.

**3. `question_id` is not `post_id`.** Metaculus endpoints want one or the other:
`/api/questions/<question_id>/` and `/api/posts/<post_id>/`. Both are stored. Group forecasts by
`question_id`; one question can have many rows (one per run, plus backfills and tests).

**4. Not every row is a tournament submission.** Dry runs, manual single-question tests and
backfills all land in the same tables. Filter on `submitted = true` and/or `workflow` before
computing anything you would call the bot's accuracy. `abstained = true` rows have no forecast.

**5. `schema_version = 1` records exist.** They predate provenance: no `provenance` block, no
structured `llm_calls`; their per-call costs were recovered by parsing the rendered usage table.
Expect missing fields rather than absent rows.

**6. `question_details` is a snapshot from run time.** Status, close time and option lists were
true when the bot ran. Anything live comes from the API.

**7. Publishing is idempotent, so duplicates are not a thing** — everything upserts on
`(run_id, question_id)` (plus `call_no` for `llm_calls`). Republishing a run updates it.

---

## 6. The Metaculus API side

The bot's own client is `metaculus_client.py`; the reader repo only needs the conventions.

- Base URL `https://www.metaculus.com/api`.
- Auth header: `Authorization: Token <METACULUS_TOKEN>`. A token is only needed for
  authenticated actions; public question reads generally work without one. **Never put a token
  in browser code.**
- **Space requests by about 3 seconds** (`METACULUS_REQUEST_INTERVAL`, default 3.0 in the bot).
  Metaculus rate-limits, and 429s carry a `Retry-After` the bot honours. A reader that bulk
  refreshes should cache aggressively and back off on 429 using `Retry-After`.
- Endpoints the bot uses, all useful to a reader:
  - `GET /questions/<question_id>/` — one question. Some shapes nest it, so read
    `data.get("question") or data`.
  - `GET /posts/<post_id>/` — post details, including resolution state.
  - `GET /posts/?…` — list a tournament's posts (the bot pages this to enumerate questions).
- Tournament slugs the library holds data for (from the bot's `config.py`):
  `metaculus-cup-fall-2026` (current cup), the Fall 2026 AI-benchmarking tournament,
  `minibench`, `ai-2027`, plus older seasons.

Division of labour: **anything the bot recorded → Supabase; anything about the world right now →
the API.** In particular the community prediction is *not* in the library, so a "bot vs
community" comparison needs a live API call, or a small cache table of your own.

---

## 7. Current state, as of 2026-09-25

- The schema and security migrations are applied; the `forecast-runs` bucket exists.
- Publishing is wired into every forecast workflow as an `always()` / `continue-on-error` step,
  so it can never fail a forecast run and is a silent no-op without credentials.
- Publishing **works**: the 2026-09-24 run of question 45859 reported `1 published, 0 failed`.
  A dropped-connection failure on 2026-09-22 (run 35721920713, `Connection reset by peer`) was
  fixed by adding 3 attempts with 2 s / 4 s backoff and retry on 429/500/502/503/504
  (`eval_tools/supabase_rest.py`). Errors now name the file and its byte size.
- The daily `score-outcomes.yaml` fills `outcomes` and `scores`.
- **Open item:** the run for question 45809 still needs republishing via the *Backfill the
  forecast library from saved artifacts* workflow. GitHub result artifacts expire after 14 days,
  so backfill only recovers what is still inside that window.
- **Open question:** the owner believes uploads may not be reaching the database despite the
  success log. Nothing has been checked against the live database yet — a good first task for
  this repo is simply to count rows per table and list the most recent `run_id`s.

## 8. First queries to run

```sql
-- Does the library have anything, and how fresh is it?
select count(*) as forecasts, count(distinct run_id) as runs, max(run_at) as newest
from forecasts;

-- Recent runs and whether they submitted
select run_id, workflow, count(*) as questions,
       sum(submitted::int) as submitted, sum(total_cost_usd) as cost_usd, max(run_at) as run_at
from forecasts group by run_id, workflow order by max(run_at) desc limit 20;

-- Which models actually forecast, done correctly (not via the tier columns)
select e ->> 'model' as model, count(*) as runs
from forecasts f, jsonb_array_elements(f.raw -> 'extra' -> 'ensemble') e
group by 1 order by 2 desc;

-- Real dollars vs free quota, kept separate
select cost_source, count(*) as calls, sum(cost_usd) as usd, sum(quota_microdollars) as quota_ud
from llm_calls group by 1;

-- Scored submissions, best first (lower is better)
select question_id, title, metric, score, resolution
from forecast_library where submitted and score is not null order by score limit 50;
```

Through PostgREST the same reads look like
`GET /rest/v1/forecast_library?submitted=eq.true&score=not.is.null&order=score.asc&limit=50`.
