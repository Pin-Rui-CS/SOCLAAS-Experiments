/** Mirrors the shape returned by /api/models. */
export type ModelInfo = {
  id: string;
  /** Emits a separate reasoning stream before the answer. */
  reasons: boolean;
  /** Verified to emit well-formed tool calls, so web access can be offered. */
  tools: boolean;
};
