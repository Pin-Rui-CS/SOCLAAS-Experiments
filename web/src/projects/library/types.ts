/** Shapes the handler returns and the view renders. Types only — safe on both sides. */

export type FileKey = "research" | "runs" | "audit" | "evolution";

export type Distribution = {
  /** `value` is null when the quantile falls outside the question's bounds; `side` says which. */
  quantiles: { q: number; value: number | null; side?: "below" | "above" }[];
  belowRange: number;
  aboveRange: number;
  /** False when no x-axis was available and values are on the unit interval. */
  scaled: boolean;
};

export type ForecastValue =
  | { kind: "binary"; p: number }
  | { kind: "mc"; options: Record<string, number> }
  | { kind: "distribution"; distribution: Distribution }
  | {
      kind: "mixture";
      components: { name: string; family: string; weight: number | null; p50: number | null }[];
    };

/** A Metaculus tournament. `name` may be missing when only the slug is known. */
export type Competition = { slug: string; name: string | null };

export type LibraryItem = {
  runId: string;
  questionId: number;
  postId: number | null;
  title: string;
  type: string;
  /**
   * From `raw.tournaments` (bot, 2026-09-27 on) or the run's CLI tournaments.
   * `null` means not recorded — the client looks it up from Metaculus.
   */
  competitions: Competition[] | null;
  runAt: string | null;
  workflow: string | null;
  submitted: boolean;
  abstained: boolean;
  costUsd: number | null;
  final: ForecastValue | null;
  unit: string;
  outcome: string | null;
  resolution: string | null;
  metric: string | null;
  score: number | null;
};

export type RunEntry = {
  index: number;
  model: string;
  dropped: boolean;
  repaired: boolean;
  valid: boolean;
  flags: string[];
  value: ForecastValue | null;
};

export type CostLine = {
  model: string;
  /** native | price_table | quota — see handoff §5.2 */
  source: string;
  calls: number;
  usd: number;
  /** Quota allowance, NOT dollars. Never add to `usd`. */
  quotaMicro: number;
  inputTokens: number;
  outputTokens: number;
  seconds: number;
};

export type ArtifactCheck = {
  status?: string;
  what_was_found?: string;
  what_is_missing?: string;
  closest_available?: string;
  forecast_swing?: string;
  retry_queries?: string[];
};

/** One CDF on the question's grid, for the charts. */
export type CurveSeries = {
  id: string;
  label: string;
  kind: "submitted" | "run";
  /** 1-based ensemble position, which fixes the run's colour. */
  runIndex?: number;
  cdf: number[];
};

/** Numeric/discrete only: the submitted CDF plus each used run, all on `x`. */
export type Curves = {
  /** Nominal x-value of each grid point — `question_details.scaling.continuous_range`. */
  x: number[];
  discrete: boolean;
  lowerOpen: boolean;
  upperOpen: boolean;
  series: CurveSeries[];
  /** Runs that could not be drawn, and why. */
  notes: string[];
};

/** How far the used runs disagreed, per run so the UI can place each one. */
export type Spread =
  | { kind: "binary"; points: { runIndex: number; p: number }[] }
  | { kind: "mc"; options: Record<string, { runIndex: number; p: number }[]> }
  | {
      kind: "distribution";
      /** Each run's median; null when it lies outside the question's range. */
      medians: { runIndex: number; value: number | null; side?: "below" | "above" }[];
    };

export type ForecastDetail = {
  runId: string;
  questionId: number;
  postId: number | null;
  title: string;
  type: string;
  runAt: string | null;
  workflow: string | null;
  runUrl: string | null;
  codeSha: string | null;
  schemaVersion: number;
  submitted: boolean;
  abstained: boolean;
  question: {
    resolutionCriteria: string;
    fineprint: string;
    description: string;
    options: string[] | null;
    unit: string;
    statusAtRun: string | null;
    closeTime: string | null;
    resolveTime: string | null;
  };
  final: ForecastValue | null;
  curves: Curves | null;
  spread: Spread | null;
  runs: RunEntry[];
  artifactCheck: ArtifactCheck | null;
  degradedProviders: string[];
  timings: { research_seconds?: number; forecast_seconds?: number; total_seconds?: number } | null;
  cost: CostLine[];
  outcome: {
    status: string | null;
    resolution: string | null;
    resolvedAt: string | null;
    metric: string | null;
    score: number | null;
  };
};

export type LiveQuestion = {
  status: string | null;
  resolution: string | null;
  closeTime: string | null;
  cpRevealTime: string | null;
  forecasters: number | null;
  forecasts: number | null;
  /** Null when Metaculus withholds the aggregate from this token. */
  community: ForecastValue | null;
  fetchedAt: string;
  cached: boolean;
};
