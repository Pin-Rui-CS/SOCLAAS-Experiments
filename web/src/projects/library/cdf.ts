import type { Distribution } from "./types.ts";

/**
 * CDF helpers shared by the server (list and detail summaries) and the charts.
 * Pure, no imports beyond types, so it is safe in the client bundle and under
 * plain Node.
 */

export const QUANTILES = [0.1, 0.25, 0.5, 0.75, 0.9];

/**
 * Read quantiles off a Metaculus CDF. `cdf[i]` is P(X ≤ range[i]); the mass
 * below `cdf[0]` and above `cdf[last]` sits outside the question's bounds, so a
 * quantile landing there has no value — only a side. Linear interpolation
 * between grid points, well inside the precision anyone reads a forecast at.
 *
 * The grid is 201 points for numeric questions but `outcome_count + 1` for
 * discrete ones (92 for 45707), so nothing here assumes a length.
 */
export function summarizeCdf(
  cdf: number[],
  range: number[] | null,
  quantiles: number[] = QUANTILES,
): Distribution | null {
  if (!Array.isArray(cdf) || cdf.length < 2) return null;
  const xs = range && range.length === cdf.length
    ? range
    : cdf.map((_, i) => i / (cdf.length - 1)); // unscaled fallback

  const at = (q: number): Distribution["quantiles"][number] => {
    if (q < cdf[0]) return { q, value: null, side: "below" };
    if (q > cdf[cdf.length - 1]) return { q, value: null, side: "above" };
    for (let i = 1; i < cdf.length; i++) {
      if (cdf[i] >= q) {
        const span = cdf[i] - cdf[i - 1];
        const t = span > 0 ? (q - cdf[i - 1]) / span : 0;
        return { q, value: xs[i - 1] + t * (xs[i] - xs[i - 1]) };
      }
    }
    return { q, value: xs[xs.length - 1] };
  };

  return {
    quantiles: quantiles.map(at),
    belowRange: cdf[0],
    aboveRange: 1 - cdf[cdf.length - 1],
    scaled: xs === range,
  };
}
