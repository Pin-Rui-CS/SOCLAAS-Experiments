/** Mirrors the shape returned by /api/models. */
export type ModelInfo = {
  id: string;
  /** Emits a separate reasoning stream before the answer. */
  reasons: boolean;
};
