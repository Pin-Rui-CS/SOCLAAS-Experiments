/** Shapes the handler returns and the view renders. Types only — safe on both sides. */

export type FileKey = "research" | "runs" | "audit" | "evolution";

export type Distribution = {
  /** `value` is null when the quantile falls outside the question's bounds. */
  quantiles: { q: number; value: number | null }[];
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

export type LibraryItem = {
  runId: string;
  questionId: number;
  postId: number | null;
  title: string;
  type: string;
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
