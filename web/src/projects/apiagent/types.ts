/** Mirrors the shape returned by /api/models. */
export type ModelInfo = {
  id: string;
  /** Emits a separate reasoning stream before the answer. */
  reasons: boolean;
  /**
   * Verified to emit well-formed tool calls.
   *
   * A hard requirement here rather than a feature flag: this project answers
   * every question through tools, so a model without this cannot be used at
   * all. The picker filters on it and the route refuses on it.
   */
  tools: boolean;
};

/**
 * The metadata the route attaches to a finished turn.
 *
 * `tiersUsed` is the one worth reading. An answer resting only on Tier B
 * sources is a weaker claim than one with a Tier A source behind it, and this
 * lets the UI say so without asking the model to be honest about it.
 */
export type TurnCost = {
  model?: string;
  lookups?: number;
  calls?: number;
  failures?: number;
  tiersUsed?: string[];
  totalTokens?: number;
};
