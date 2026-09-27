/**
 * Render a run's distribution spec as a CDF on the question's grid — the same
 * thing the bot's `spec_to_cdf` does (bot repo, forecasters/numeric.py).
 *
 * Why this exists: the library stores each run's SPEC (`run_values[i].spec`)
 * but not its rendered CDF. That spec is the post-guardrail, post-unit-rescale
 * one the bot actually evaluated, on the grid that is
 * `question_details.scaling.continuous_range`. So evaluating it here
 * reproduces the run's raw CDF. Two bot steps are NOT replayed and the UI says
 * so: `_standardize_cdf` (applied to the aggregate only) and
 * `repair_coarse_pmf_run_cdfs` (PMF runs only).
 *
 * Families mirror `build_distribution` one for one, with scipy's
 * parameterisations. A family added there must be added here; `verify.ts`
 * fails when a stored spec does not render.
 *
 * Pure TypeScript, no dependencies, `.ts` imports only — it runs under plain
 * Node for the cross-check against scipy, and in the browser bundle alike.
 */

type Params = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Cdf = (x: number) => number;

// --- Special functions ------------------------------------------------------------

/** Complementary error function. Numerical Recipes `erfcc`: fractional error < 1.2e-7. */
function erfc(x: number): number {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const r =
    t *
    Math.exp(
      -z * z - 1.26551223 +
        t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 +
        t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 +
        t * 0.17087277)))))))),
    );
  return x >= 0 ? r : 2 - r;
}

/** Standard normal CDF. */
export function phi(z: number): number {
  return 0.5 * erfc(-z / Math.SQRT2);
}

/** ln Γ(x), Lanczos (g = 7, n = 9). Accurate to ~1e-15 for x > 0. */
function lgamma(x: number): number {
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012,
    9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lgamma(1 - x);
  x -= 1;
  let a = c[0];
  const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

const EPS = 1e-15;
const FPMIN = 1e-300;
const MAX_ITER = 500;

/** Regularized lower incomplete gamma P(a, x). Numerical Recipes `gammp`. */
function gammaP(a: number, x: number): number {
  if (x <= 0) return 0;
  const gln = lgamma(a);
  if (x < a + 1) {
    // series
    let ap = a;
    let sum = 1 / a;
    let del = sum;
    for (let n = 0; n < MAX_ITER; n++) {
      ap += 1;
      del *= x / ap;
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * EPS) break;
    }
    return sum * Math.exp(-x + a * Math.log(x) - gln);
  }
  // continued fraction for Q, then P = 1 - Q
  let b = x + 1 - a;
  let c = 1 / FPMIN;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < MAX_ITER; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = b + an / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return 1 - Math.exp(-x + a * Math.log(x) - gln) * h;
}

/** Continued fraction for the incomplete beta. Numerical Recipes `betacf`. */
function betacf(a: number, b: number, x: number): number {
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m < MAX_ITER; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/** Regularized incomplete beta I_x(a, b). */
function betaI(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(
    lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x),
  );
  return x < (a + 1) / (a + b + 2)
    ? (front * betacf(a, b, x)) / a
    : 1 - (front * betacf(b, a, 1 - x)) / b;
}

/** Adaptive Simpson, for Owen's T. */
function integrate(f: (x: number) => number, a: number, b: number, tol = 1e-12): number {
  const simpson = (fa: number, fm: number, fb: number, w: number) => (w / 6) * (fa + 4 * fm + fb);
  const recurse = (
    a: number, b: number, fa: number, fm: number, fb: number, whole: number, tol: number, depth: number,
  ): number => {
    const m = (a + b) / 2;
    const lm = (a + m) / 2;
    const rm = (m + b) / 2;
    const flm = f(lm);
    const frm = f(rm);
    const left = simpson(fa, flm, fm, m - a);
    const right = simpson(fm, frm, fb, b - m);
    if (depth <= 0 || Math.abs(left + right - whole) <= 15 * tol) {
      return left + right + (left + right - whole) / 15;
    }
    return (
      recurse(a, m, fa, flm, fm, left, tol / 2, depth - 1) +
      recurse(m, b, fm, frm, fb, right, tol / 2, depth - 1)
    );
  };
  const fa = f(a);
  const fb = f(b);
  const fm = f((a + b) / 2);
  return recurse(a, b, fa, fm, fb, simpson(fa, fm, fb, b - a), tol, 40);
}

/** Owen's T(h, a) = (1/2π) ∫₀ᵃ exp(−h²(1+x²)/2) / (1+x²) dx. */
function owensT(h: number, a: number): number {
  if (a === 0) return 0;
  if (a < 0) return -owensT(h, -a);
  const f = (x: number) => Math.exp((-h * h * (1 + x * x)) / 2) / (1 + x * x);
  return integrate(f, 0, a) / (2 * Math.PI);
}

// --- Families (scipy parameterisations, as build_distribution uses them) ------------

function paramsOf(spec: Params): Params {
  if (spec.params && typeof spec.params === "object") return spec.params;
  const { type: _type, ...rest } = spec; // eslint-disable-line @typescript-eslint/no-unused-vars
  return rest;
}

function positive(value: unknown, name: string): number {
  const n = Number(value);
  if (!(n > 0)) throw new Error(`${name} must be > 0, got ${value}`);
  return n;
}

function build(spec: Params): Cdf {
  const t = spec.type;
  const p = paramsOf(spec);

  switch (t) {
    case "normal": {
      const sd = positive(p.std ?? p.sd, "normal: std");
      const mean = Number(p.mean);
      return (x) => phi((x - mean) / sd);
    }
    case "mixture_normal": {
      const w: number[] = p.weights.map(Number);
      const parts = p.means.map((m: number, i: number) => {
        const sd = positive(p.stds[i], "mixture_normal: std");
        return (x: number) => phi((x - m) / sd);
      });
      return (x) => parts.reduce((acc: number, c: Cdf, i: number) => acc + w[i] * c(x), 0);
    }
    case "skew_normal": {
      // scipy skewnorm: F(z) = Φ(z) − 2·T(z, α)
      const scale = positive(p.scale, "skew_normal: scale");
      const loc = Number(p.location);
      const alpha = Number(p.alpha);
      return (x) => {
        const z = (x - loc) / scale;
        return phi(z) - 2 * owensT(z, alpha);
      };
    }
    case "student_t": {
      const df = positive(p.df, "student_t: df");
      const scale = positive(p.scale, "student_t: scale");
      const loc = Number(p.location);
      return (x) => {
        const z = (x - loc) / scale;
        const tail = 0.5 * betaI(df / 2, 0.5, df / (df + z * z));
        return z > 0 ? 1 - tail : tail;
      };
    }
    case "beta": {
      const a = positive(p.a, "beta: a");
      const b = positive(p.b, "beta: b");
      const lo = Number(p.lower);
      const hi = Number(p.upper);
      if (!(hi > lo)) throw new Error("beta: upper must be > lower");
      return (x) => betaI(a, b, (x - lo) / (hi - lo));
    }
    case "lognormal":
    case "log_normal": {
      const sigma = positive(p.sigma, "lognormal: sigma");
      const scale = "median" in p ? positive(p.median, "lognormal: median") : Math.exp(Number(p.mu));
      const mu = Math.log(scale);
      return (x) => (x > 0 ? phi((Math.log(x) - mu) / sigma) : 0);
    }
    case "gamma": {
      const mean = positive(p.mean, "gamma: mean");
      const shape = positive(p.shape, "gamma: shape");
      const scale = mean / shape;
      return (x) => gammaP(shape, x / scale);
    }
    case "truncated_normal": {
      const sd = positive(p.sd, "truncated_normal: sd");
      const mean = Number(p.mean);
      const lo = Number(p.lo);
      const hi = Number(p.hi);
      if (!(hi > lo)) throw new Error("truncated_normal: hi must be > lo");
      const pa = phi((lo - mean) / sd);
      const pb = phi((hi - mean) / sd);
      return (x) => (x <= lo ? 0 : x >= hi ? 1 : (phi((x - mean) / sd) - pa) / (pb - pa));
    }
    case "uniform": {
      const lo = Number(p.lower);
      const hi = Number(p.upper);
      if (!(hi > lo)) throw new Error("uniform: upper must be > lower");
      return (x) => Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
    }
    case "mixture": {
      const components: Params[] = p.components ?? [];
      if (!components.length) throw new Error("mixture: components must be nonempty");
      const weights = components.map((c) => Number(c.weight));
      if (weights.some((w) => w < 0)) throw new Error("mixture: negative weight");
      const total = weights.reduce((a, b) => a + b, 0);
      if (!(total > 0)) throw new Error("mixture: weights must sum to a positive number");
      const built = components.map(build);
      return (x) => built.reduce((acc, c, i) => acc + (weights[i] / total) * c(x), 0);
    }
    default:
      throw new Error(`unknown distribution type: ${t}`);
  }
}

// --- pmf (pmf_spec_to_cdf) ----------------------------------------------------------

function coercePmfValue(value: unknown): number {
  if (typeof value === "number") return value;
  let text = String(value).trim().replace(/,/g, "");
  if (text.endsWith("+")) text = text.slice(0, -1);
  const n = Number(text);
  if (!Number.isFinite(n)) throw new Error(`pmf: bad value ${value}`);
  return n;
}

function pmfCdf(spec: Params, xs: number[]): number[] {
  const p = paramsOf(spec);
  let values: number[] = [];
  let probs: number[] = [];
  if (p.values != null && p.probabilities != null) {
    values = p.values.map(coercePmfValue);
    probs = p.probabilities.map(Number);
  } else {
    const table = p.pmf || p.probability_by_value;
    if (table && typeof table === "object") {
      const pairs = Object.entries(table)
        .map(([v, q]) => [coercePmfValue(v), Number(q)] as const)
        .sort((a, b) => a[0] - b[0]);
      values = pairs.map((x) => x[0]);
      probs = pairs.map((x) => x[1]);
    }
  }
  if (!values.length || !probs.length) throw new Error("pmf: values and probabilities must be nonempty");
  if (values.length !== probs.length) {
    // Same tolerance as the bot: an off-by-two slip is truncated, more is an error.
    if (Math.abs(values.length - probs.length) > 2) throw new Error("pmf: length mismatch");
    const n = Math.min(values.length, probs.length);
    values = values.slice(0, n);
    probs = probs.slice(0, n);
  }
  if (probs.some((q) => !Number.isFinite(q) || q < 0)) throw new Error("pmf: bad probabilities");
  const total = probs.reduce((a, b) => a + b, 0);
  if (!(total > 0)) throw new Error("pmf: probabilities must sum to a positive number");

  return monotone(
    xs.map((threshold) =>
      values.reduce((acc, v, i) => (v <= threshold ? acc + probs[i] / total : acc), 0),
    ),
  );
}

// --- Entry point --------------------------------------------------------------------

/** Clip to [0, 1] and force non-decreasing — `np.maximum.accumulate(np.clip(...))`. */
function monotone(values: number[]): number[] {
  let running = 0;
  return values.map((v) => (running = Math.max(running, Math.min(1, Math.max(0, v)))));
}

/** A run's CDF on `xs`. Throws on an unknown family or invalid parameters. */
export function specCdf(spec: Params, xs: number[]): number[] {
  if (!spec || typeof spec !== "object") throw new Error("no spec");
  if (spec.type === "pmf") return pmfCdf(spec, xs);
  const cdf = build(spec);
  return monotone(xs.map(cdf));
}
