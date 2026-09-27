"use client";

import type { ReactNode } from "react";
import type { ForecastDetail } from "../types";
import { DistributionCharts, runColor, seriesColor } from "./DistributionCharts";
import { formatNumber, pct } from "./Value";

/**
 * The top of a forecast: what was submitted, how far the models disagreed, and
 * what it cost. Everything else lives in the tabs below.
 */
export function Glance({ detail: d, unit }: { detail: ForecastDetail; unit: string }) {
  return (
    <div
      className="glance"
      style={{
        marginTop: 18,
        border: "1px solid var(--border)",
        borderRadius: 12,
        background: "var(--bg-raised)",
        padding: "18px 20px",
      }}
    >
      <div className="glance-top">
        <div style={{ minWidth: 0 }}>
          <Label>Forecast</Label>
          <Headline detail={d} unit={unit} />
          <Resolved detail={d} />
        </div>
        <CostTiles detail={d} />
      </div>

      {d.curves && (
        <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
          <DistributionCharts curves={d.curves} unit={unit} table={false} />
        </div>
      )}

      <style>{`
        .glance { container-type: inline-size; }
        .glance-top { display: grid; grid-template-columns: 1fr; gap: 18px; }
        @container (min-width: 620px) { .glance-top { grid-template-columns: minmax(0, 1fr) 210px; gap: 28px; } }
      `}</style>
    </div>
  );
}

function Label({ children }: { children: ReactNode }) {
  return (
    <div style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--text-faint)", marginBottom: 6 }}>
      {children}
    </div>
  );
}

const big = { fontSize: 34, fontWeight: 650, letterSpacing: "-0.02em", lineHeight: 1.1, fontVariantNumeric: "tabular-nums" } as const;

function range(values: number[], format: (v: number) => string): string {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  return lo === hi ? format(lo) : `${format(lo)} – ${format(hi)}`;
}

function Headline({ detail: d, unit }: { detail: ForecastDetail; unit: string }) {
  const f = d.final;
  const spread = d.spread;
  if (d.abstained || !f) return <div style={{ color: "var(--text-muted)" }}>Abstained — no forecast submitted.</div>;

  if (f.kind === "binary") {
    const points = spread?.kind === "binary" ? spread.points : [];
    return (
      <>
        <div style={big}>
          {pct(f.p)} <span style={{ fontSize: 16, fontWeight: 500, color: "var(--text-muted)" }}>Yes</span>
        </div>
        {points.length > 0 && (
          <>
            <Strip submitted={f.p} points={points} />
            <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
              {points.length} models: {range(points.map((p) => p.p), (v) => pct(v))}
            </div>
          </>
        )}
      </>
    );
  }

  if (f.kind === "mc") {
    const byModel = spread?.kind === "mc" ? spread.options : {};
    const rows = Object.entries(f.options).sort((a, b) => b[1] - a[1]);
    return (
      <div style={{ display: "grid", gap: 8, marginTop: 4 }}>
        {rows.map(([option, p], i) => {
          const models = (byModel[option] ?? []).map((m) => m.p);
          return (
            <div key={option} style={{ display: "grid", gridTemplateColumns: "minmax(90px, 200px) 1fr 58px", gap: 12, alignItems: "center" }}>
              <span style={{ fontSize: 13.5, fontWeight: i === 0 ? 600 : 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={option}>
                {option}
              </span>
              <OptionBar p={p} models={models} />
              <span style={{ textAlign: "right", fontSize: i === 0 ? 16 : 13.5, fontWeight: i === 0 ? 650 : 500, fontVariantNumeric: "tabular-nums" }}>
                {pct(p)}
              </span>
            </div>
          );
        })}
        <div style={{ fontSize: 12, color: "var(--text-faint)" }}>Whiskers: lowest to highest model.</div>
      </div>
    );
  }

  if (f.kind === "distribution") {
    const q = (level: number) => f.distribution.quantiles.find((x) => x.q === level);
    const show = (x: { value: number | null; side?: string } | undefined) =>
      !x ? "—" : x.value == null ? `${x.side ?? "out of"} range` : formatNumber(x.value, unit);
    const medians = spread?.kind === "distribution" ? spread.medians : [];
    const inRange = medians.filter((m) => m.value != null).map((m) => m.value!);
    return (
      <>
        <div style={big}>{show(q(0.5))}</div>
        <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>
          median · 80% interval {show(q(0.1))} – {show(q(0.9))}
        </div>
        {medians.length > 0 && (
          <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 2 }}>
            {medians.length} model medians:{" "}
            {inRange.length ? range(inRange, (v) => formatNumber(v, unit)) : "all out of range"}
            {inRange.length < medians.length && inRange.length > 0 ? ` (+${medians.length - inRange.length} out of range)` : ""}
          </div>
        )}
      </>
    );
  }
  return null;
}

/** A 0–100% track: one dot per model, a bar for the submitted value. */
function Strip({ submitted, points }: { submitted: number; points: { runIndex: number; p: number }[] }) {
  return (
    <div style={{ position: "relative", height: 30, margin: "10px 0 2px" }} role="img" aria-label={`Submitted ${pct(submitted)}; models ${points.map((p) => pct(p.p)).join(", ")}`}>
      <div style={{ position: "absolute", left: 0, right: 0, top: 13, height: 4, borderRadius: 2, background: "var(--bg-hover)" }} />
      {[0, 0.5, 1].map((t) => (
        <span key={t} style={{ position: "absolute", left: `${t * 100}%`, top: 20, transform: `translateX(${t === 0 ? "0" : t === 1 ? "-100%" : "-50%"})`, fontSize: 10.5, color: "var(--text-faint)" }}>
          {pct(t, 0)}
        </span>
      ))}
      {points.map((p) => (
        <span
          key={p.runIndex}
          title={`Run ${p.runIndex}: ${pct(p.p)}`}
          style={{
            position: "absolute",
            left: `${p.p * 100}%`,
            top: 9,
            width: 12,
            height: 12,
            marginLeft: -6,
            borderRadius: "50%",
            background: runColor(p.runIndex) ?? "var(--text-muted)",
            border: "2px solid var(--bg-raised)",
          }}
        />
      ))}
      <span
        title={`Submitted: ${pct(submitted)}`}
        style={{
          position: "absolute",
          left: `${submitted * 100}%`,
          top: 5,
          width: 3,
          height: 20,
          marginLeft: -1.5,
          borderRadius: 2,
          background: seriesColor({ kind: "submitted" }) ?? "var(--accent)",
        }}
      />
    </div>
  );
}

/** Submitted probability as a bar, with the models' min–max as a whisker. */
function OptionBar({ p, models }: { p: number; models: number[] }) {
  const lo = models.length ? Math.min(...models) : null;
  const hi = models.length ? Math.max(...models) : null;
  return (
    <div
      style={{ position: "relative", height: 14 }}
      title={lo != null ? `models ${pct(lo)} – ${pct(hi!)}` : undefined}
    >
      <div style={{ position: "absolute", inset: "3px 0", borderRadius: 4, background: "var(--bg-hover)" }} />
      <div style={{ position: "absolute", left: 0, top: 3, bottom: 3, width: `${Math.min(1, p) * 100}%`, borderRadius: 4, background: "var(--viz-1)" }} />
      {lo != null && (
        <>
          <div style={{ position: "absolute", top: 6.5, height: 1.5, left: `${lo * 100}%`, width: `${(hi! - lo) * 100}%`, background: "var(--text)" }} />
          <div style={{ position: "absolute", top: 1, height: 12, width: 1.5, left: `${lo * 100}%`, background: "var(--text)" }} />
          <div style={{ position: "absolute", top: 1, height: 12, width: 1.5, left: `${hi! * 100}%`, marginLeft: -1.5, background: "var(--text)" }} />
        </>
      )}
    </div>
  );
}

function Resolved({ detail: d }: { detail: ForecastDetail }) {
  const o = d.outcome;
  if (o.status !== "resolved") return null;
  return (
    <div style={{ marginTop: 10, fontSize: 13 }}>
      Resolved <strong>{o.resolution ?? "—"}</strong>
      {o.score != null && (
        <span style={{ color: "var(--text-muted)" }}>
          {" "}· {o.metric} <strong style={{ color: "var(--text)" }}>{o.score.toFixed(4)}</strong> (lower is better)
        </span>
      )}
    </div>
  );
}

/** §5.2: real dollars and quota side by side, never added. */
function CostTiles({ detail: d }: { detail: ForecastDetail }) {
  const usd = d.cost.reduce((a, c) => a + c.usd, 0);
  const quota = d.cost.reduce((a, c) => a + c.quotaMicro, 0);
  const calls = d.cost.reduce((a, c) => a + c.calls, 0);
  const seconds = d.timings?.total_seconds;
  const tile = { border: "1px solid var(--border)", borderRadius: 8, padding: "8px 12px", background: "var(--bg)" } as const;
  return (
    <div>
      <Label>Cost</Label>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <div style={tile}>
          <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>Real spend</div>
          <div style={{ fontSize: 18, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>${usd.toFixed(2)}</div>
        </div>
        <div style={tile} title="SoCLaaS allowance in microdollars — not real money, never added to spend">
          <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>Quota (µ$)</div>
          <div style={{ fontSize: 18, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{formatNumber(quota)}</div>
        </div>
      </div>
      <div style={{ fontSize: 12, color: "var(--text-faint)", marginTop: 6 }}>
        {calls} calls{seconds != null ? ` · ${formatDuration(seconds)}` : ""}
      </div>
    </div>
  );
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m ? `${m}m ${s}s` : `${s}s`;
}
