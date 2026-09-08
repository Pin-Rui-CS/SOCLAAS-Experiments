/**
 * Live check against every adapter. No gateway quota, no model, no key.
 *
 * Run it with:
 *
 *   npm run test:apiagent
 *
 * This is the first thing to run after touching an adapter, and the only way to
 * find out that one of `api-registry-crossref.md`'s endpoints has moved. The
 * document is a snapshot of someone's research; §4 flags one factual conflict it
 * could not resolve on its own, and several of these services have changed
 * their API since it was written. Assume nothing here is live until this passes.
 *
 * It runs under plain Node — no ts-node, no tsx — which is why every import in
 * this subtree carries an explicit `.ts` extension and avoids the `@/` alias.
 */

import { adapters, find } from "./registry.ts";
import { HttpError, ShapeError } from "./http.ts";

type Case = {
  id: string;
  params: Record<string, unknown>;
  note?: string;
  /**
   * Report a failure loudly but keep it out of the exit code.
   *
   * Only for endpoints whose UNRELIABILITY IS THE MEASURED FACT, not for ones
   * that are merely inconvenient. GDELT is the sole case: it rate limits a
   * single address hard enough that a red suite would mean "GDELT again" nine
   * times out of ten, and a check that cries wolf gets ignored — which is how a
   * real regression slips through. The line still prints in red.
   */
  flaky?: boolean;
};

/**
 * One call per adapter, chosen to return rows on a normal day.
 *
 * Where the crossref names a specific worked example, use it — the Keflavík
 * observation below is the §2a failure case (Q44953), and a pass here is the
 * evidence that the fix actually works rather than merely being described.
 */
const CASES: Case[] = [
  {
    id: "gdelt_doc",
    params: { query: "climate summit", timespan: "7d" },
    flaky: true,
    note: "rate limits one address hard; see the adapter's header",
  },
  { id: "sec_edgar", params: { ticker: "AAPL", form: "8-K" } },
  { id: "federal_register", params: { term: "emissions", type: "RULE" } },
  { id: "clinicaltrials", params: { condition: "type 2 diabetes" } },
  {
    id: "openfda",
    params: { dataset: "food/enforcement", search: "classification:*" },
  },
  { id: "cisa_kev", params: { query: "microsoft" } },
  { id: "arxiv", params: { query: "cat:cs.LG" } },
  { id: "launch_library", params: { mode: "upcoming" } },
  {
    id: "iem_asos",
    params: { station: "BIKF", startDate: "2026-08-12", endDate: "2026-08-12" },
    note: "the crossref §2a worked example (Q44953)",
  },
  { id: "coinbase_candles", params: { product: "BTC-USD", granularity: "86400" } },
  {
    id: "fdic_failures",
    params: { from: "2000-01-01", to: "2026-09-06" },
    note: "wide range — failures are rare, a narrow one proves nothing",
  },
  { id: "who_outbreaks", params: { search: "Ebola" } },
  { id: "cboe_vix", params: { from: "2026-08-01", to: "2026-09-06" } },
  {
    id: "imf_portwatch",
    params: {
      chokepoint: "Strait of Hormuz",
      from: "2026-08-01",
      to: "2026-08-25",
    },
    note: "window ends well back — PortWatch refreshes weekly",
  },
  {
    id: "fred",
    params: { mode: "info", seriesId: "CPIAUCSL" },
    note: "the §5 temporal-feasibility gate; skipped without FRED_API_KEY",
  },
  { id: "wikipedia", params: { page: "Iceland" } },
  { id: "wikipedia", params: { mode: "search", query: "hurricane season" } },
  {
    id: "usgs_earthquakes",
    params: { from: "2026-08-01", to: "2026-09-08", minMagnitude: 6 },
  },
  {
    id: "world_bank",
    params: { mode: "observations", country: "SGP", indicator: "NY.GDP.MKTP.CD" },
  },
  {
    id: "wikipedia_pageviews",
    params: { article: "Ebola", from: "2026-08-25", to: "2026-09-01" },
  },
  { id: "nhc_storms", params: {} },
  { id: "github", params: { mode: "releases", repo: "vercel/next.js" } },
  { id: "polymarket", params: { query: "president" } },
  { id: "kalshi", params: { query: "Fed" } },
  { id: "metaculus", params: { search: "recession" } },
];

/** Matcher expectations. Cheap, offline, and the part most likely to rot. */
const ROUTING: Array<{ need: string; expect: string }> = [
  { need: "How many US banks failed in August 2026?", expect: "fdic_failures" },
  {
    need: "Was the sky clear over Reykjavik on 12 August 2026?",
    expect: "iem_asos",
  },
  { need: "Did Putin and Trump speak by phone recently?", expect: "gdelt_doc" },
  { need: "Will Apple file an 8-K this quarter?", expect: "sec_edgar" },
  { need: "Did bitcoin trade above 200000 dollars?", expect: "coinbase_candles" },
  { need: "Will CVE-2026-1234 be added to the KEV catalogue?", expect: "cisa_kev" },
  { need: "How many orbital rocket launches happened in August?", expect: "launch_library" },
  { need: "Will the FDA recall any peanut products this month?", expect: "openfda" },
  { need: "Has WHO reported a new Ebola outbreak in the DRC?", expect: "who_outbreaks" },
  { need: "How many ships transited the Strait of Hormuz last week?", expect: "imf_portwatch" },
  { need: "Will the VIX close above 25 this month?", expect: "cboe_vix" },
  { need: "What was the US inflation rate in August?", expect: "fred" },
  { need: "Was there a magnitude 7 earthquake in Japan this month?", expect: "usgs_earthquakes" },
  { need: "What is Singapore's GDP per capita?", expect: "world_bank" },
  { need: "Is there an active hurricane in the Atlantic right now?", expect: "nhc_storms" },
  { need: "Has React released version 20 yet?", expect: "github" },
  { need: "What do prediction markets say about the election?", expect: "polymarket" },
  { need: "Did Wikipedia pageviews for Ebola spike in August?", expect: "wikipedia_pageviews" },
];

/**
 * Matcher regressions — the false positives the word-boundary rewrite fixed.
 *
 * `expect: false` means "this adapter must NOT appear at all". Before the
 * rewrite, "rate" scored against sec_edgar because it is a substring of
 * "corporate"; keeping the case pins that shut.
 */
const ANTI_ROUTING: Array<{ need: string; reject: string; why: string }> = [
  {
    need: "What was the US inflation rate in August?",
    reject: "sec_edgar",
    why: '"rate" must not match the word "corporate"',
  },
  {
    need: "How many ships transited the Strait of Hormuz?",
    reject: "arxiv",
    why: "a lone prose coincidence must not clear the score floor",
  },
];

/**
 * Schema expectations, checked offline.
 *
 * These exist because a silently-altered request is worse than a rejected one.
 * GDELT used to accept `startDate` alone and quietly search its default seven
 * days instead, so the model asked for a month, got a week, and then reported
 * an absence for a window nobody had looked at. A schema that refuses is the
 * fix; these cases are what stop it regressing.
 */
const PARAMS: Array<{ id: string; params: unknown; valid: boolean; why: string }> = [
  {
    id: "gdelt_doc",
    params: { query: "test", startDate: "2026-08-06" },
    valid: true,
    why: "startDate alone means a window ending today",
  },
  {
    id: "gdelt_doc",
    params: { query: "test", endDate: "2026-08-06" },
    valid: false,
    why: "endDate alone must be refused, not reinterpreted",
  },
  {
    id: "iem_asos",
    params: { station: "BIKF", startDate: "2026-08-12" },
    valid: false,
    why: "a date range needs both ends",
  },
  {
    id: "fdic_failures",
    params: { from: "2026-01-01", to: "2026-08-31" },
    valid: true,
    why: "the crossref's worked example",
  },
  {
    id: "coinbase_candles",
    params: { product: "BTC-USD", granularity: "90" },
    valid: false,
    why: "granularity is an enum of what Coinbase actually supports",
  },
  {
    id: "imf_portwatch",
    params: { chokepoint: "Suez", from: "2026-08-01", to: "2026-08-25" },
    valid: false,
    why: "chokepoint names are an enum — a near-miss must not reach the query",
  },
  {
    id: "fred",
    params: { mode: "info", seriesId: "CPIAUCSL" },
    valid: true,
    why: "the mode that answers whether a figure has been published yet",
  },
  {
    id: "kalshi",
    params: { query: "Fed", category: "Macroeconomics" },
    valid: false,
    why: "category is Kalshi's own enum, not a free-text label",
  },
  {
    id: "world_bank",
    params: { mode: "observations", country: "Singapore", indicator: "NY.GDP.MKTP.CD" },
    valid: false,
    why: "country is an ISO code, so a full name must be refused not guessed at",
  },
  {
    id: "wikipedia_pageviews",
    params: { article: "Ebola", from: "2026-08-25" },
    valid: false,
    why: "a date range needs both ends",
  },
  {
    id: "github",
    params: { mode: "releases", repo: "next.js" },
    valid: false,
    why: "repo must be owner/name, or the URL silently 404s",
  },
];

const GREEN = "[32m";
const RED = "[31m";
const YELLOW = "[33m";
const DIM = "[2m";
const RESET = "[0m";

function describe(error: unknown): string {
  if (error instanceof ShapeError) {
    return `SHAPE  expected ${error.expected}\n         received ${error.received}`;
  }
  if (error instanceof HttpError) {
    return `HTTP ${error.status}  ${error.body}`;
  }
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  return String(error);
}

/** First row, short enough to eyeball. Proves fields are populated, not just present. */
function sample(rows: unknown[]): string {
  if (rows.length === 0) return "(no rows)";
  const text = JSON.stringify(rows[0]);
  return text.length > 220 ? `${text.slice(0, 220)}…` : text;
}

type Outcome = "pass" | "fail" | "skip" | "flaky";

async function runCase(testCase: Case): Promise<Outcome> {
  // Deliberately the full list, not `activeAdapters()` — an adapter that is
  // switched off for want of a key should be REPORTED as such, not silently
  // absent from the run. Silence is how a broken adapter hides.
  const adapter = adapters.find((entry) => entry.id === testCase.id);
  if (!adapter) {
    console.log(`${RED}MISSING${RESET} ${testCase.id} — not in the registry`);
    return "fail";
  }

  const label = `${adapter.name} ${DIM}[${adapter.id}, tier ${adapter.tier}]${RESET}`;

  if (adapter.available?.() === false) {
    console.log(`${YELLOW}SKIP${RESET}    ${label}  ${DIM}no key configured${RESET}`);
    return "skip";
  }

  const started = Date.now();

  try {
    const parsed = adapter.paramsSchema.safeParse(testCase.params);
    if (!parsed.success) {
      console.log(`${RED}FAIL${RESET}    ${label}`);
      console.log(`         params rejected by its own schema: ${parsed.error.message}`);
      return "fail";
    }

    // Generous: GDELT alone can spend 15s waiting on its own rate gate before
    // it even makes a request, and this ceiling is only here to stop the whole
    // run hanging on a dead host.
    const result = await adapter.run(parsed.data, AbortSignal.timeout(90_000));
    const ms = Date.now() - started;

    console.log(`${GREEN}PASS${RESET}    ${label}  ${DIM}${result.rows.length} rows, ${ms}ms${RESET}`);
    if (testCase.note) console.log(`         ${DIM}${testCase.note}${RESET}`);
    console.log(`         ${DIM}${sample(result.rows)}${RESET}`);
    if (result.rows.length === 0) {
      console.log(`         ${DIM}note: ${result.note ?? "(none)"}${RESET}`);
    }
    return "pass";
  } catch (error) {
    const tag = testCase.flaky ? `${RED}FAIL${RESET}${DIM}*${RESET}` : `${RED}FAIL${RESET}`;
    console.log(`${tag}   ${label}  ${DIM}${Date.now() - started}ms${RESET}`);
    console.log(`         ${describe(error)}`);
    if (testCase.flaky) {
      console.log(`         ${DIM}* known flaky — not counted against the run${RESET}`);
      return "flaky";
    }
    return "fail";
  }
}

function runRouting(): boolean {
  let ok = true;
  for (const { need, expect } of ROUTING) {
    /*
     * An expectation naming a switched-off adapter cannot be checked, because
     * `find` only ever returns adapters that could actually be called. Skipping
     * is the honest report: the routing is unverified until a key is set, not
     * broken.
     */
    const target = adapters.find((entry) => entry.id === expect);
    if (target?.available?.() === false) {
      console.log(
        `${YELLOW}SKIP${RESET}    ${DIM}${expect} is switched off${RESET}  ${need}`,
      );
      continue;
    }

    const candidates = find(need);
    const position = candidates.findIndex((candidate) => candidate.id === expect);

    if (position === 0) {
      console.log(`${GREEN}PASS${RESET}    ${DIM}top hit ${expect}${RESET}  ${need}`);
    } else if (position > 0) {
      console.log(`${GREEN}PASS${RESET}    ${DIM}#${position + 1} of ${candidates.length}, ${expect}${RESET}  ${need}`);
    } else {
      console.log(`${RED}FAIL${RESET}    expected ${expect}, got ${candidates.map((c) => c.id).join(", ") || "nothing"}`);
      console.log(`         ${need}`);
      ok = false;
    }
  }
  return ok;
}

function runAntiRouting(): boolean {
  let ok = true;
  for (const { need, reject, why } of ANTI_ROUTING) {
    const ids = find(need).map((candidate) => candidate.id);
    if (ids.includes(reject)) {
      console.log(`${RED}FAIL${RESET}    ${reject} still matches — ${why}`);
      console.log(`         ${need}
         got: ${ids.join(", ")}`);
      ok = false;
    } else {
      console.log(`${GREEN}PASS${RESET}    ${DIM}${reject} rejected${RESET}  ${why}`);
    }
  }
  return ok;
}

function runParams(): boolean {
  let ok = true;
  for (const { id, params, valid, why } of PARAMS) {
    const adapter = adapters.find((entry) => entry.id === id);
    if (!adapter) {
      console.log(`${RED}FAIL${RESET}    no adapter ${id}`);
      ok = false;
      continue;
    }

    const accepted = adapter.paramsSchema.safeParse(params).success;
    if (accepted === valid) {
      console.log(
        `${GREEN}PASS${RESET}    ${DIM}${id} ${valid ? "accepts" : "rejects"}${RESET}  ${why}`,
      );
    } else {
      console.log(
        `${RED}FAIL${RESET}    ${id} ${accepted ? "accepted" : "rejected"} ` +
          `${JSON.stringify(params)} — ${why}`,
      );
      ok = false;
    }
  }
  return ok;
}

async function main(): Promise<void> {
  console.log(`\n${DIM}Parameters — offline, no requests${RESET}\n`);
  const paramsOk = runParams();

  console.log(`\n${DIM}Routing — offline, no requests${RESET}\n`);
  const routingOk = runRouting();

  console.log(`\n${DIM}Matcher regressions — must NOT match${RESET}\n`);
  const antiOk = runAntiRouting();

  console.log(`\n${DIM}Adapters — ${CASES.length} live requests, in parallel${RESET}\n`);
  const results = await Promise.all(CASES.map(runCase));
  const passed = results.filter((outcome) => outcome === "pass").length;
  const skipped = results.filter((outcome) => outcome === "skip").length;
  const failed = results.filter((outcome) => outcome === "fail").length;
  const flaky = results.filter((outcome) => outcome === "flaky").length;

  const missing = adapters
    .filter((adapter) => !CASES.some((testCase) => testCase.id === adapter.id))
    .map((adapter) => adapter.id);
  if (missing.length) {
    console.log(`\n${RED}No smoke case for: ${missing.join(", ")}${RESET}`);
  }

  console.log(
    `\n${passed} live, ${skipped} skipped, ${failed} failed` +
      (flaky ? `, ${flaky} flaky` : "") +
      ` ${DIM}(${adapters.length} adapters registered)${RESET}\n`,
  );

  if (failed > 0 || !routingOk || !antiOk || !paramsOk || missing.length) {
    process.exit(1);
  }
}

await main();
