"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { summarizeCdf } from "../cdf";
import type { Curves, CurveSeries } from "../types";
import { formatNumber, pct } from "./Value";

/**
 * CDF and PDF of a numeric/discrete forecast: the submitted curve plus each
 * run's, overlaid. Two separate charts, each on its own y-scale — never one
 * chart with two.
 *
 * x is plotted in Metaculus's scaled location (grid index / (n − 1)) and
 * labelled in nominal units, which makes log-scaled questions come out right
 * with no special case and is identical to a linear axis otherwise.
 *
 * The PDF is the probability mass in each grid step, not a per-unit density:
 * on the scaled axis every step is the same width, so the shape is the true
 * density there, and the numbers stay readable (a per-dollar density is 3e-5).
 */

/*
 * Categorical slots from the dataviz reference palette, validated on this
 * site's own surfaces (#ffffff light, #131316 dark): every check passes; three
 * light slots sit under 3:1 contrast, which the legend and table view relieve.
 * The submitted forecast is slot 1; run N is slot N + 1, so a model keeps its
 * colour in the ensemble list too.
 */
const SLOTS = 8;

/**
 * The palette as CSS variables, for `scope` — applied once at the library
 * view's root, because run swatches outside the charts (the ensemble list) must
 * resolve the same colours.
 */
export function vizPaletteCss(scope: string): string {
  return `
    ${scope} {
      --viz-1: #2a78d6; --viz-2: #eb6834; --viz-3: #1baf7a; --viz-4: #eda100;
      --viz-5: #e87ba4; --viz-6: #008300; --viz-7: #4a3aa7; --viz-8: #e34948;
    }
    @media (prefers-color-scheme: dark) {
      ${scope} {
        --viz-1: #3987e5; --viz-2: #d95926; --viz-3: #199e70; --viz-4: #c98500;
        --viz-5: #d55181; --viz-6: #008300; --viz-7: #9085e9; --viz-8: #e66767;
      }
    }`;
}

export function seriesColor(series: Pick<CurveSeries, "kind" | "runIndex">): string | null {
  const slot = series.kind === "submitted" ? 1 : (series.runIndex ?? 0) + 1;
  return slot >= 1 && slot <= SLOTS ? `var(--viz-${slot})` : null;
}

export function runColor(runIndex: number): string | null {
  return seriesColor({ kind: "run", runIndex });
}

export function DistributionCharts({
  curves,
  unit,
  table = true,
}: {
  curves: Curves;
  unit: string;
  /** Offer the per-series table below the charts. The glance card leaves it to the Models tab. */
  table?: boolean;
}) {
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [showTable, setShowTable] = useState(false);

  // A run past the eighth slot would need a generated hue; it goes to the table only.
  const drawable = curves.series.filter((s) => seriesColor(s));
  const visible = drawable.filter((s) => !hidden.has(s.id));
  const runCount = curves.series.filter((s) => s.kind === "run").length;

  const toggle = (id: string) =>
    setHidden((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="viz" style={{ marginTop: 16 }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px 14px", marginBottom: 8 }}>
        {drawable.map((s) => {
          const off = hidden.has(s.id);
          return (
            <button
              key={s.id}
              onClick={() => toggle(s.id)}
              aria-pressed={!off}
              title={off ? "Show" : "Hide"}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "2px 6px",
                border: "none",
                background: "transparent",
                cursor: "pointer",
                fontSize: 12.5,
                opacity: off ? 0.45 : 1,
                textDecoration: off ? "line-through" : "none",
              }}
            >
              <Swatch color={seriesColor(s)!} thick={s.kind === "submitted"} />
              {s.kind === "run" ? `Run ${s.runIndex} · ${s.label}` : s.label}
            </button>
          );
        })}
      </div>
      {runCount > 0 && (
        <div style={{ fontSize: 12, color: "var(--text-faint)", marginBottom: 10 }}>
          Thin lines: each model&apos;s own distribution. Thick: the submitted blend of them.
        </div>
      )}

      <div className="viz-pair">
        <Chart title="Cumulative — P(X ≤ x)" mode="cdf" curves={curves} series={visible} unit={unit} />
        <Chart
          title={curves.discrete ? "Probability of each outcome" : "Density (probability per grid step)"}
          mode="pdf"
          curves={curves}
          series={visible}
          unit={unit}
        />
      </div>

      <TailNote curves={curves} />
      {curves.notes.map((note) => (
        <div key={note} style={{ fontSize: 12, color: "var(--warn-text)" }}>{note}</div>
      ))}

      {table && <button
        onClick={() => setShowTable((v) => !v)}
        aria-expanded={showTable}
        style={{
          marginTop: 8,
          padding: "3px 10px",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          background: "transparent",
          cursor: "pointer",
          fontSize: 12.5,
        }}
      >
        {showTable ? "Hide table" : "Show table"}
      </button>}
      {table && showTable && <SeriesTable curves={curves} unit={unit} />}

      <style>{`
        ${vizPaletteCss(".viz")}
        .viz { container-type: inline-size; }
        .viz-pair { display: grid; grid-template-columns: 1fr; gap: 0 24px; }
        .viz-pair > * { min-width: 0; }
        /* Side by side once each chart can be ~420px wide. */
        @container (min-width: 880px) { .viz-pair { grid-template-columns: 1fr 1fr; } }
        .viz-chart:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
      `}</style>
    </div>
  );
}

/* ------------------------------------------------------------------ chart */

const HEIGHT = 220;
const M = { top: 10, right: 14, bottom: 30, left: 46 };

type Mode = "cdf" | "pdf";

/** Probability mass of each grid step: step j covers x[j]..x[j+1]. */
function masses(cdf: number[]): number[] {
  const out: number[] = [];
  for (let j = 0; j < cdf.length - 1; j++) out.push(Math.max(0, cdf[j + 1] - cdf[j]));
  return out;
}

function niceStep(span: number, count: number): number {
  const raw = span / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? raw;
}

/** Round tick values inside [min, max], about `count` of them. */
function niceTicks(min: number, max: number, count: number): number[] {
  const span = max - min;
  if (!(span > 0)) return [min];
  const step = niceStep(span, count);
  const ticks: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) {
    ticks.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  }
  return ticks;
}

/** Position (0..1) of a nominal value on the grid, by interpolating the x array. */
function locate(x: number[], value: number): number | null {
  const n = x.length;
  if (value < x[0] || value > x[n - 1]) return null;
  for (let i = 1; i < n; i++) {
    if (x[i] >= value) {
      const t = x[i] > x[i - 1] ? (value - x[i - 1]) / (x[i] - x[i - 1]) : 0;
      return (i - 1 + t) / (n - 1);
    }
  }
  return 1;
}

function Chart({
  title,
  mode,
  curves,
  series,
  unit,
}: {
  title: string;
  mode: Mode;
  curves: Curves;
  series: CurveSeries[];
  unit: string;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(260, entry.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const n = curves.x.length;
  const plotW = width - M.left - M.right;
  const plotH = HEIGHT - M.top - M.bottom;
  const px = (t: number) => M.left + t * plotW;

  // Per-series values in this chart's terms.
  const data = useMemo(
    () => series.map((s) => ({ s, values: mode === "cdf" ? s.cdf : masses(s.cdf) })),
    [series, mode],
  );

  const yMax = useMemo(() => {
    if (mode === "cdf") return 1;
    // Round UP to a tick, or the tallest curve runs off the top of the plot.
    const peak = Math.max(0, ...data.flatMap((d) => d.values));
    if (!(peak > 0)) return 0.01;
    const step = niceStep(peak, 4);
    return Math.ceil((peak * 1.04) / step) * step;
  }, [data, mode]);
  const py = (v: number) => M.top + plotH - (v / yMax) * plotH;
  const yTicks = mode === "cdf" ? [0, 0.25, 0.5, 0.75, 1] : niceTicks(0, yMax, 4);

  // Where on the scaled axis each value sits.
  const tOf = (i: number) =>
    mode === "cdf" ? i / (n - 1) : (i + 0.5) / (n - 1); // pdf: step midpoint

  const paths = useMemo(
    () =>
      data.map(({ s, values }) => {
        let d = "";
        if (mode === "pdf" && curves.discrete) {
          // One flat step per outcome.
          values.forEach((v, j) => {
            const x0 = px(j / (n - 1));
            const x1 = px((j + 1) / (n - 1));
            d += `${j === 0 ? "M" : "L"}${x0.toFixed(1)},${py(v).toFixed(1)}H${x1.toFixed(1)}`;
          });
        } else {
          values.forEach((v, i) => {
            d += `${i === 0 ? "M" : "L"}${px(tOf(i)).toFixed(1)},${py(v).toFixed(1)}`;
          });
        }
        return { s, d };
      }),
    // px/py/tOf are derived from width, yMax and n, all listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, width, yMax, n, mode, curves.discrete],
  );

  // Nominal-value ticks placed where they fall on the (possibly log-warped) grid.
  const xTicks = useMemo(() => {
    const count = Math.max(3, Math.floor(plotW / 110));
    return niceTicks(curves.x[0], curves.x[n - 1], count)
      .map((v) => ({ v, t: locate(curves.x, v) }))
      .filter((tick): tick is { v: number; t: number } => tick.t !== null);
  }, [curves.x, n, plotW]);

  const last = mode === "cdf" ? n - 1 : n - 2;
  const indexAt = (clientX: number) => {
    const rect = wrap.current!.getBoundingClientRect();
    const t = (clientX - rect.left - M.left) / plotW;
    const i = mode === "cdf" ? Math.round(t * (n - 1)) : Math.floor(t * (n - 1));
    return Math.min(last, Math.max(0, i));
  };

  const onPointer = (e: PointerEvent<HTMLDivElement>) => setHover(indexAt(e.clientX));
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 10 : 1;
    const current = hover ?? Math.floor(last / 2);
    const next =
      e.key === "ArrowRight" ? current + step
      : e.key === "ArrowLeft" ? current - step
      : e.key === "Home" ? 0
      : e.key === "End" ? last
      : null;
    if (next === null) return;
    e.preventDefault();
    setHover(Math.min(last, Math.max(0, next)));
  };

  const hx = hover === null ? null : px(tOf(hover));
  // Discrete grid points are cell EDGES, halfway between outcomes; outcome j is
  // the midpoint of cell j. So "≤ edge i" reads as "≤ the outcome just below it".
  const outcome = (j: number) => (curves.x[j] + curves.x[j + 1]) / 2;
  const heading =
    hover === null ? ""
    : mode === "cdf"
      ? curves.discrete
        ? hover === 0 ? "below the lowest outcome" : `x ≤ ${formatNumber(outcome(hover - 1), unit)}`
        : `x ≤ ${formatNumber(curves.x[hover], unit)}`
    : curves.discrete ? `x = ${formatNumber(outcome(hover), unit)}`
    : `${formatNumber(curves.x[hover], unit)} – ${formatNumber(curves.x[hover + 1], unit)}`;

  return (
    <figure style={{ margin: "0 0 14px" }}>
      <figcaption style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 4 }}>
        {title}{unit ? ` · ${unit}` : ""}
      </figcaption>
      <div
        ref={wrap}
        className="viz-chart"
        tabIndex={0}
        role="group"
        aria-label={`${title}. Use the left and right arrow keys to read values.`}
        onPointerMove={onPointer}
        onPointerLeave={() => setHover(null)}
        onKeyDown={onKey}
        onBlur={() => setHover(null)}
        style={{ position: "relative", touchAction: "pan-y", borderRadius: "var(--radius)" }}
      >
        <svg width={width} height={HEIGHT} style={{ display: "block" }}>
          {/* grid and axes: recessive */}
          {yTicks.map((v) => (
            <g key={v}>
              <line x1={M.left} x2={width - M.right} y1={py(v)} y2={py(v)} stroke="var(--border)" strokeWidth={1} />
              <text x={M.left - 6} y={py(v)} textAnchor="end" dominantBaseline="middle" fontSize={11} fill="var(--text-muted)">
                {pct(v, mode === "cdf" ? 0 : 1)}
              </text>
            </g>
          ))}
          {xTicks.map(({ v, t }) => (
            <g key={v}>
              <line x1={px(t)} x2={px(t)} y1={M.top + plotH} y2={M.top + plotH + 4} stroke="var(--border-strong)" />
              <text
                x={px(t)}
                y={HEIGHT - 10}
                // Edge labels turn inward so they are never cut off by the frame.
                textAnchor={t > 0.95 ? "end" : t < 0.03 ? "start" : "middle"}
                fontSize={11}
                fill="var(--text-muted)"
              >
                {formatNumber(v)}
              </text>
            </g>
          ))}
          <line x1={M.left} x2={width - M.right} y1={M.top + plotH} y2={M.top + plotH} stroke="var(--border-strong)" />

          {/* submitted last, so it sits on top of the runs */}
          {[...paths].sort((a, b) => (a.s.kind === "submitted" ? 1 : 0) - (b.s.kind === "submitted" ? 1 : 0)).map(({ s, d }) => (
            <path
              key={s.id}
              d={d}
              fill="none"
              stroke={seriesColor(s)!}
              strokeWidth={s.kind === "submitted" ? 2.5 : 1.5}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}

          {hx !== null && (
            <>
              <line x1={hx} x2={hx} y1={M.top} y2={M.top + plotH} stroke="var(--text-faint)" strokeWidth={1} />
              {data.map(({ s, values }) => (
                <circle
                  key={s.id}
                  cx={hx}
                  cy={py(values[hover!])}
                  r={4}
                  fill={seriesColor(s)!}
                  stroke="var(--bg)"
                  strokeWidth={2}
                />
              ))}
            </>
          )}
        </svg>

        {/* What the tooltip shows, for screen readers following the arrow keys. */}
        <span
          aria-live="polite"
          style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" }}
        >
          {hover === null
            ? ""
            : `${heading}: ${data
                .map(({ s, values }) => `${s.kind === "run" ? `run ${s.runIndex}` : s.label} ${pct(values[hover], 1)}`)
                .join(", ")}`}
        </span>

        {hover !== null && data.length > 0 && (
          <div
            aria-hidden
            style={{
              position: "absolute",
              top: M.top,
              ...(hx! > width / 2 ? { right: width - hx! + 10 } : { left: hx! + 10 }),
              pointerEvents: "none",
              background: "var(--bg-raised)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
              padding: "6px 10px",
              fontSize: 12,
              boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
              whiteSpace: "nowrap",
              zIndex: 1,
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 3 }}>{heading}</div>
            {data.map(({ s, values }) => (
              <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <Swatch color={seriesColor(s)!} thick={s.kind === "submitted"} />
                <span style={{ color: "var(--text-muted)" }}>{s.kind === "run" ? `Run ${s.runIndex}` : s.label}</span>
                <span style={{ marginLeft: "auto", paddingLeft: 12, fontVariantNumeric: "tabular-nums" }}>
                  {pct(values[hover], 1)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </figure>
  );
}

/* ----------------------------------------------------------------- pieces */

function Swatch({ color, thick }: { color: string; thick?: boolean }) {
  return (
    <span
      aria-hidden
      style={{
        display: "inline-block",
        width: 14,
        height: thick ? 3 : 2,
        borderRadius: 2,
        background: color,
        flexShrink: 0,
      }}
    />
  );
}

/** Mass outside an open bound cannot sit on the axis; say how much there is. */
function TailNote({ curves }: { curves: Curves }) {
  const submitted = curves.series.find((s) => s.kind === "submitted");
  if (!submitted) return null;
  const below = submitted.cdf[0];
  const above = 1 - submitted.cdf[submitted.cdf.length - 1];
  if (below < 0.005 && above < 0.005) return null;
  return (
    <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>
      Off the chart: {pct(below)} below the range, {pct(above)} above it
      {curves.lowerOpen || curves.upperOpen ? " (open bound)" : ""}.
    </div>
  );
}

export function SeriesTable({ curves, unit }: { curves: Curves; unit: string }) {
  const cell = { padding: "5px 8px", borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" } as const;
  const num = { ...cell, textAlign: "right", fontVariantNumeric: "tabular-nums" } as const;
  const show = (q: { value: number | null; side?: string }) =>
    q.value == null ? `${q.side ?? "out of"} range` : formatNumber(q.value);

  return (
    <div style={{ overflowX: "auto", marginTop: 8 }}>
      {unit && <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>Values in {unit}</div>}
      <table style={{ borderCollapse: "collapse", fontSize: 12.5, width: "100%" }}>
        <thead>
          <tr style={{ color: "var(--text-muted)", textAlign: "left" }}>
            {["Series", "p10", "p50", "p90", "Below range", "Above range"].map((h) => (
              <th key={h} style={h === "Series" ? cell : { ...num, textAlign: "right" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {curves.series.map((s) => {
            const summary = summarizeCdf(s.cdf, curves.x, [0.1, 0.5, 0.9]);
            if (!summary) return null;
            const color = seriesColor(s);
            return (
              <tr key={s.id}>
                <td style={cell}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    {color && <Swatch color={color} thick={s.kind === "submitted"} />}
                    {s.kind === "run" ? `Run ${s.runIndex} · ${s.label}` : s.label}
                  </span>
                </td>
                {summary.quantiles.map((q) => (
                  <td key={q.q} style={num}>{show(q)}</td>
                ))}
                <td style={num}>{pct(summary.belowRange)}</td>
                <td style={num}>{pct(summary.aboveRange)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
