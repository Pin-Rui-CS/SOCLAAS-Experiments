"use client";

import { useState, type ReactNode } from "react";
import {
  compactSeconds,
  shortModelName,
  type NodeStatus,
  type PipelineGraph,
  type SelectionTarget,
} from "../pipeline";
import type { ForecastDetail, RunEntry } from "../types";
import { DistributionCharts, runColor, seriesColor } from "./DistributionCharts";
import { formatNumber, pct } from "./Value";

/**
 * Top 2-card Bento summary:
 * 1. Verdict & Ensemble Forecasters (every model's individual answer at a glance;
 *    click any row to read its reasoning in the slide-over Inspector).
 * 2. Spend & Shared Systems (real USD vs SoCLaaS quota kept strictly separate,
 *    top model bars, and clickable Fetcher / Searcher / SoCLaaS system pills).
 */
export function BentoSummary({
  detail: d,
  unit,
  graph,
  onSelect,
}: {
  detail: ForecastDetail;
  unit: string;
  graph: PipelineGraph;
  onSelect: (target: SelectionTarget) => void;
}) {
  const [curvesOpen, setCurvesOpen] = useState(true);

  return (
    <div style={{ marginTop: 14 }}>
      {d.qwenOutage && (
        <div
          role="note"
          style={{
            marginBottom: 10,
            padding: "7px 12px",
            borderRadius: "var(--radius)",
            fontSize: 12.5,
            background: "var(--warn-bg)",
            border: "1px solid var(--warn-border)",
            color: "var(--warn-text)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
          }}
        >
          <span>
            <strong>Degraded research:</strong> SoCLaaS outage during run — {d.qwenOutage}
          </span>
          <button
            type="button"
            onClick={() => onSelect({ kind: "system", systemId: "soclaas" })}
            style={ghostLink}
          >
            Inspect ↗
          </button>
        </div>
      )}

      <div className="lib-bento">
        {/* LEFT CARD: VERDICT + INDIVIDUAL FORECASTERS */}
        <section style={cardStyle} aria-label="Forecast verdict and ensemble">
          <div style={cardHeader}>
            <Eyebrow>Verdict &amp; Forecasters</Eyebrow>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {d.tiebreakerUsed && <MiniBadge tone="warn">Tiebreaker</MiniBadge>}
              {d.extremised && <MiniBadge>Extremised</MiniBadge>}
              {d.postedComment && (
                <button
                  type="button"
                  onClick={() => onSelect({ kind: "comment" })}
                  style={ghostLink}
                >
                  Comment ↗
                </button>
              )}
              {d.curves && (
                <button
                  type="button"
                  onClick={() => setCurvesOpen((v) => !v)}
                  aria-expanded={curvesOpen}
                  style={ghostLink}
                >
                  {curvesOpen ? "Hide curves ▴" : "Curves ▾"}
                </button>
              )}
            </div>
          </div>

          <HeadlineCompact detail={d} unit={unit} />

          {d.outcome.status === "resolved" && (
            <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-muted)" }}>
              Resolved <strong style={{ color: "var(--text)" }}>{d.outcome.resolution ?? "—"}</strong>
              {d.outcome.score != null && (
                <span>
                  {" "}
                  · {d.outcome.metric}{" "}
                  <strong style={{ color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>
                    {d.outcome.score.toFixed(4)}
                  </strong>
                </span>
              )}
            </div>
          )}

          {/* Individual Forecaster Votes */}
          {d.runs.length > 0 && (
            <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--border)", display: "grid", gap: 2 }}>
              {d.runs.map((run) => (
                <ForecasterRow
                  key={run.index}
                  run={run}
                  detail={d}
                  unit={unit}
                  isRaw={graph.rawRunIndices.has(run.index)}
                  onClick={() => onSelect({ kind: "run", runIndex: run.index })}
                />
              ))}
            </div>
          )}
        </section>

        {/* RIGHT CARD: SPEND + SHARED SYSTEMS */}
        <section style={cardStyle} aria-label="Cost and shared infrastructure">
          <div style={cardHeader}>
            <Eyebrow>Spend &amp; Systems</Eyebrow>
            <button type="button" onClick={() => onSelect({ kind: "cost" })} style={ghostLink}>
              All calls ({d.llmCalls.length || d.cost.reduce((a, c) => a + c.calls, 0)}) ↗
            </button>
          </div>

          <CostSummaryTiles detail={d} onInspect={() => onSelect({ kind: "cost" })} />

          <ModelCostBars detail={d} onInspect={() => onSelect({ kind: "cost" })} />

          <div style={{ marginTop: "auto", paddingTop: 10, borderTop: "1px solid var(--border)" }}>
            <div style={{ fontSize: 11, color: "var(--text-faint)", fontWeight: 550, marginBottom: 6 }}>
              Centralised Systems
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 6 }}>
              {graph.systems.map((sys) => (
                <button
                  key={sys.id}
                  type="button"
                  onClick={() => onSelect({ kind: "system", systemId: sys.id })}
                  className="lib-hover-surface"
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-start",
                    gap: 2,
                    padding: "6px 8px",
                    borderRadius: 6,
                    border: "1px solid var(--border)",
                    background: "var(--bg)",
                    cursor: "pointer",
                    textAlign: "left",
                    minWidth: 0,
                  }}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: 5, width: "100%" }}>
                    <StatusDotSmall status={sys.status} />
                    <span style={{ fontSize: 11.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {sys.title}
                    </span>
                  </span>
                  <span
                    style={{
                      fontSize: 11,
                      color: "var(--text-muted)",
                      fontFamily: "var(--font-mono)",
                      fontVariantNumeric: "tabular-nums",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      width: "100%",
                    }}
                  >
                    {sys.pill}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </section>
      </div>

      {/* Collapsible CDF / PDF Overlay for Numeric & Discrete Questions */}
      {d.curves && curvesOpen && (
        <div
          style={{
            marginTop: 10,
            padding: "10px 16px 12px",
            border: "1px solid var(--border)",
            borderRadius: 10,
            background: "var(--bg-raised)",
          }}
        >
          <DistributionCharts curves={d.curves} unit={unit} table={false} />
        </div>
      )}
    </div>
  );
}

/* ----------------------------------------------------------- verdict pieces */

function HeadlineCompact({ detail: d, unit }: { detail: ForecastDetail; unit: string }) {
  const f = d.final;
  const spread = d.spread;
  if (d.abstained || !f) {
    return <div style={{ fontSize: 14, color: "var(--text-muted)", padding: "4px 0" }}>Abstained — no forecast submitted.</div>;
  }

  if (f.kind === "binary") {
    const points = spread?.kind === "binary" ? spread.points : [];
    return (
      <div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span style={heroNum}>{pct(f.p)}</span>
          <span style={{ fontSize: 14, fontWeight: 500, color: "var(--text-muted)" }}>Yes</span>
        </div>
        {points.length > 0 && <BinaryStrip submitted={f.p} points={points} />}
      </div>
    );
  }

  if (f.kind === "mc") {
    const byModel = spread?.kind === "mc" ? spread.options : {};
    const rows = Object.entries(f.options).sort((a, b) => b[1] - a[1]);
    return (
      <div style={{ display: "grid", gap: 5, marginTop: 2 }}>
        {rows.slice(0, 6).map(([option, p], i) => {
          const models = (byModel[option] ?? []).map((m) => m.p);
          const lo = models.length ? Math.min(...models) : null;
          const hi = models.length ? Math.max(...models) : null;
          return (
            <div
              key={option}
              style={{ display: "grid", gridTemplateColumns: "minmax(80px, 165px) 1fr 50px", gap: 10, alignItems: "center" }}
            >
              <span
                style={{
                  fontSize: 12.5,
                  fontWeight: i === 0 ? 600 : 440,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={option}
              >
                {option}
              </span>
              <div
                style={{ position: "relative", height: 12 }}
                title={lo != null ? `Models: ${pct(lo)} – ${pct(hi!)}` : undefined}
              >
                <div style={{ position: "absolute", inset: "3px 0", borderRadius: 3, background: "var(--bg-hover)" }} />
                <div
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 3,
                    bottom: 3,
                    width: `${Math.min(1, p) * 100}%`,
                    borderRadius: 3,
                    background: "var(--viz-1)",
                  }}
                />
                {lo != null && (
                  <>
                    <div style={{ position: "absolute", top: 5.5, height: 1, left: `${lo * 100}%`, width: `${(hi! - lo) * 100}%`, background: "var(--text)" }} />
                    <div style={{ position: "absolute", top: 2, height: 8, width: 1.5, left: `${lo * 100}%`, background: "var(--text)" }} />
                    <div style={{ position: "absolute", top: 2, height: 8, width: 1.5, left: `${hi! * 100}%`, marginLeft: -1.5, background: "var(--text)" }} />
                  </>
                )}
              </div>
              <span
                style={{
                  textAlign: "right",
                  fontSize: 12.5,
                  fontWeight: i === 0 ? 650 : 500,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {pct(p)}
              </span>
            </div>
          );
        })}
      </div>
    );
  }

  if (f.kind === "distribution") {
    const q = (level: number) => f.distribution.quantiles.find((x) => x.q === level);
    const show = (x: { value: number | null; side?: string } | undefined) =>
      !x ? "—" : x.value == null ? `${x.side ?? "out of"} range` : formatNumber(x.value, unit);
    return (
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "4px 14px" }}>
        <span style={heroNum}>{show(q(0.5))}</span>
        <span style={{ fontSize: 12.5, color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>
          80% interval: {show(q(0.1))} – {show(q(0.9))}
        </span>
      </div>
    );
  }
  return null;
}

function BinaryStrip({ submitted, points }: { submitted: number; points: { runIndex: number; p: number }[] }) {
  return (
    <div style={{ position: "relative", height: 22, marginTop: 6 }}>
      <div style={{ position: "absolute", left: 0, right: 0, top: 9, height: 4, borderRadius: 2, background: "var(--bg-hover)" }} />
      {points.map((p) => (
        <span
          key={p.runIndex}
          title={`Run ${p.runIndex}: ${pct(p.p)}`}
          style={{
            position: "absolute",
            left: `${p.p * 100}%`,
            top: 5,
            width: 11,
            height: 11,
            marginLeft: -5.5,
            borderRadius: "50%",
            background: runColor(p.runIndex) ?? "var(--text-muted)",
            border: "1.5px solid var(--bg-raised)",
          }}
        />
      ))}
      <span
        title={`Submitted: ${pct(submitted)}`}
        style={{
          position: "absolute",
          left: `${submitted * 100}%`,
          top: 2,
          width: 2.5,
          height: 17,
          marginLeft: -1.25,
          borderRadius: 2,
          background: seriesColor({ kind: "submitted" }) ?? "var(--accent)",
        }}
      />
    </div>
  );
}

function ForecasterRow({
  run,
  detail: d,
  unit,
  isRaw,
  onClick,
}: {
  run: RunEntry;
  detail: ForecastDetail;
  unit: string;
  isRaw: boolean;
  onClick: () => void;
}) {
  const answer = formatRunAnswer(run, d, unit);
  const color = run.dropped ? "var(--border-strong)" : runColor(run.index) ?? "var(--text-muted)";

  return (
    <button
      type="button"
      onClick={onClick}
      className="lib-hover-surface"
      style={{
        display: "grid",
        gridTemplateColumns: "10px 18px minmax(0, 1fr) auto auto 12px",
        alignItems: "center",
        gap: 7,
        width: "100%",
        padding: "5px 6px",
        border: "none",
        borderRadius: 6,
        background: "transparent",
        cursor: "pointer",
        textAlign: "left",
        opacity: run.dropped ? 0.55 : 1,
      }}
    >
      <span style={{ width: 8, height: 8, borderRadius: 2, background: color }} />
      <span style={{ fontSize: 11.5, color: "var(--text-faint)", fontVariantNumeric: "tabular-nums" }}>#{run.index}</span>
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 12,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={run.model}
      >
        {shortModelName(run.model)}
      </span>
      <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
        <MiniBadge tone={isRaw ? "accent" : undefined}>{isRaw ? "Raw" : "Brief"}</MiniBadge>
        {run.shadow && <MiniBadge>Shadow</MiniBadge>}
        {run.repaired && <MiniBadge>Repaired</MiniBadge>}
        {run.dropped && <MiniBadge tone="warn">Dropped</MiniBadge>}
        {run.weight != null && <MiniBadge>{Math.round(run.weight * 100)}%</MiniBadge>}
      </span>
      <span
        style={{
          fontSize: 12.5,
          fontWeight: 600,
          fontVariantNumeric: "tabular-nums",
          textAlign: "right",
          whiteSpace: "nowrap",
        }}
      >
        {answer}
      </span>
      <span aria-hidden style={{ color: "var(--text-faint)", fontSize: 12, textAlign: "right" }}>
        ›
      </span>
    </button>
  );
}

function formatRunAnswer(run: RunEntry, d: ForecastDetail, unit: string): string {
  if (run.dropped) return "excluded";
  const v = run.value;
  if (!v) return "—";
  if (v.kind === "binary") return pct(v.p);
  if (v.kind === "mc") {
    const [top, p] = Object.entries(v.options).sort((a, b) => b[1] - a[1])[0] ?? [];
    return top ? `${top.slice(0, 14)}${top.length > 14 ? "…" : ""} ${pct(p)}` : "—";
  }
  if (d.spread?.kind === "distribution") {
    const med = d.spread.medians.find((m) => m.runIndex === run.index);
    if (med) {
      return med.value == null ? `${med.side ?? "out"} range` : formatNumber(med.value, unit);
    }
  }
  return v.kind === "mixture" ? `${v.components.length} comp` : "—";
}

/* ------------------------------------------------------------- spend pieces */

function CostSummaryTiles({ detail: d, onInspect }: { detail: ForecastDetail; onInspect: () => void }) {
  const usd = d.cost.reduce((a, c) => a + c.usd, 0);
  const quota = d.cost.reduce((a, c) => a + c.quotaMicro, 0);
  const totalSec = d.timings?.total_seconds;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 6 }}>
      <button type="button" onClick={onInspect} className="lib-hover-surface" style={metricTile}>
        <span style={tileLabel}>Real spend</span>
        <span style={tileValue}>${usd.toFixed(2)}</span>
      </button>
      <button
        type="button"
        onClick={onInspect}
        className="lib-hover-surface"
        style={metricTile}
        title="SoCLaaS allowance in microdollars — never summed with USD"
      >
        <span style={tileLabel}>Quota (µ$)</span>
        <span style={tileValue}>{formatNumber(quota)}</span>
      </button>
      <button type="button" onClick={onInspect} className="lib-hover-surface" style={metricTile}>
        <span style={tileLabel}>Runtime</span>
        <span style={tileValue}>{totalSec != null ? compactSeconds(totalSec) : "—"}</span>
      </button>
    </div>
  );
}

function ModelCostBars({ detail: d, onInspect }: { detail: ForecastDetail; onInspect: () => void }) {
  if (!d.cost.length) return null;
  const maxUsd = Math.max(0.0001, ...d.cost.map((c) => c.usd));
  const maxQuota = Math.max(1, ...d.cost.map((c) => c.quotaMicro));

  return (
    <div style={{ display: "grid", gap: 4, margin: "10px 0" }}>
      {d.cost.slice(0, 4).map((c) => {
        const isQuota = c.source === "quota" || (c.usd === 0 && c.quotaMicro > 0);
        const ratio = isQuota ? c.quotaMicro / maxQuota : c.usd / maxUsd;
        return (
          <button
            key={`${c.model}|${c.source}`}
            type="button"
            onClick={onInspect}
            className="lib-hover-surface"
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(90px, 145px) 1fr auto",
              alignItems: "center",
              gap: 8,
              padding: "3px 5px",
              border: "none",
              borderRadius: 5,
              background: "transparent",
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11.5,
                color: "var(--text-muted)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={`${c.model} (${c.source})`}
            >
              {shortModelName(c.model)}
            </span>
            <span style={{ height: 5, borderRadius: 3, background: "var(--bg-hover)", overflow: "hidden" }}>
              <span
                style={{
                  display: "block",
                  height: "100%",
                  width: `${Math.max(4, Math.min(100, ratio * 100))}%`,
                  background: isQuota ? "var(--text-faint)" : "var(--accent)",
                  borderRadius: 3,
                }}
              />
            </span>
            <span
              style={{
                fontSize: 11.5,
                fontFamily: "var(--font-mono)",
                fontVariantNumeric: "tabular-nums",
                color: isQuota ? "var(--text-muted)" : "var(--text)",
                whiteSpace: "nowrap",
              }}
            >
              {isQuota ? `${formatNumber(c.quotaMicro)} µ$` : `$${c.usd.toFixed(3)}`}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ----------------------------------------------------------- tiny UI atoms */

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: "0.05em",
        textTransform: "uppercase",
        color: "var(--text-faint)",
      }}
    >
      {children}
    </span>
  );
}

function MiniBadge({
  tone,
  children,
}: {
  tone?: "warn" | "accent";
  children: ReactNode;
}) {
  const bg =
    tone === "warn" ? "var(--warn-bg)" : tone === "accent" ? "var(--accent-subtle)" : "var(--bg-subtle)";
  const color =
    tone === "warn" ? "var(--warn-text)" : tone === "accent" ? "var(--accent)" : "var(--text-muted)";
  const border =
    tone === "warn" ? "var(--warn-border)" : tone === "accent" ? "transparent" : "var(--border)";
  return (
    <span
      style={{
        display: "inline-block",
        padding: "0 6px",
        borderRadius: 999,
        fontSize: 10.5,
        lineHeight: "17px",
        fontWeight: 550,
        background: bg,
        color,
        border: `1px solid ${border}`,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

function StatusDotSmall({ status }: { status: NodeStatus }) {
  const map: Record<NodeStatus, string> = {
    pass: "var(--st-pass)",
    warn: "var(--st-warn)",
    fail: "var(--st-fail)",
    skipped: "var(--st-skipped)",
  };
  return (
    <span
      aria-hidden
      style={{
        width: 7,
        height: 7,
        borderRadius: "50%",
        background: map[status],
        flexShrink: 0,
      }}
    />
  );
}

const cardStyle = {
  border: "1px solid var(--border)",
  borderRadius: 10,
  background: "var(--bg-raised)",
  padding: "13px 15px",
  display: "flex",
  flexDirection: "column",
  minWidth: 0,
} as const;

const cardHeader = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  marginBottom: 8,
} as const;

const heroNum = {
  fontSize: 28,
  fontWeight: 650,
  letterSpacing: "-0.02em",
  lineHeight: 1.1,
  fontVariantNumeric: "tabular-nums",
} as const;

const ghostLink = {
  border: "none",
  background: "none",
  padding: "2px 4px",
  cursor: "pointer",
  color: "var(--accent)",
  fontSize: 11.5,
  fontWeight: 550,
} as const;

const metricTile = {
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-start",
  gap: 2,
  padding: "7px 9px",
  border: "1px solid var(--border)",
  borderRadius: 7,
  background: "var(--bg)",
  cursor: "pointer",
  textAlign: "left",
} as const;

const tileLabel = {
  fontSize: 11,
  color: "var(--text-muted)",
} as const;

const tileValue = {
  fontSize: 16,
  fontWeight: 650,
  fontVariantNumeric: "tabular-nums",
} as const;
