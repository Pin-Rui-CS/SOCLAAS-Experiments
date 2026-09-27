"use client";

import type { ForecastValue } from "../types";

/** Formatting shared by the list and the detail pane. */

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumSignificantDigits: 4 });
const plain = new Intl.NumberFormat("en", { maximumSignificantDigits: 4 });

export function formatNumber(value: number | null | undefined, unit = ""): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const text = Math.abs(value) >= 10_000 ? compact.format(value) : plain.format(value);
  return unit ? `${text} ${unit}` : text;
}

export function pct(p: number, digits = 1): string {
  return `${(p * 100).toFixed(digits).replace(/\.0$/, "")}%`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC";
}

/** One line, for the list. */
export function valueSummary(value: ForecastValue | null, unit = ""): string {
  if (!value) return "no forecast";
  switch (value.kind) {
    case "binary":
      return pct(value.p);
    case "mc": {
      const [top, p] = Object.entries(value.options).sort((a, b) => b[1] - a[1])[0] ?? [];
      return top ? `${top} ${pct(p)}` : "—";
    }
    case "distribution": {
      const median = value.distribution.quantiles.find((q) => q.q === 0.5)?.value ?? null;
      return `median ${formatNumber(median, unit)}`;
    }
    case "mixture":
      return `${value.components.length}-component mixture`;
  }
}

/** Full rendering, for the detail pane. */
export function ValueView({ value, unit = "" }: { value: ForecastValue | null; unit?: string }) {
  if (!value) return <span style={{ color: "var(--text-faint)" }}>none</span>;

  switch (value.kind) {
    case "binary":
      return <Bar label="Yes" p={value.p} />;

    case "mc":
      return (
        <div style={{ display: "grid", gap: 4 }}>
          {Object.entries(value.options).map(([option, p]) => (
            <Bar key={option} label={option} p={p} />
          ))}
        </div>
      );

    case "distribution": {
      const d = value.distribution;
      return (
        <div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 18px" }}>
            {d.quantiles.map(({ q, value: x }) => (
              <span key={q} style={{ whiteSpace: "nowrap" }}>
                <span style={{ color: "var(--text-muted)" }}>p{Math.round(q * 100)} </span>
                <strong style={{ fontVariantNumeric: "tabular-nums" }}>
                  {x == null ? "out of range" : formatNumber(x, unit)}
                </strong>
              </span>
            ))}
          </div>
          {(d.belowRange > 0.001 || d.aboveRange > 0.001) && (
            <div style={{ color: "var(--text-muted)", fontSize: 12.5, marginTop: 4 }}>
              {pct(d.belowRange)} below range · {pct(d.aboveRange)} above range
            </div>
          )}
          {!d.scaled && (
            <div style={{ color: "var(--warn-text)", fontSize: 12.5 }}>
              No x-axis recorded; values are positions on the unit interval.
            </div>
          )}
        </div>
      );
    }

    case "mixture":
      return (
        <div style={{ display: "grid", gap: 2, fontSize: 13 }}>
          {value.components.map((c, i) => (
            <div key={i}>
              <span style={{ color: "var(--text-muted)" }}>
                {c.weight != null ? `${pct(c.weight, 0)} ` : ""}
                {c.family}
              </span>{" "}
              {c.name !== c.family && c.name}
              {c.p50 != null && (
                <span style={{ color: "var(--text-muted)" }}> · p50 {formatNumber(c.p50, unit)}</span>
              )}
            </div>
          ))}
        </div>
      );
  }
}

function Bar({ label, p }: { label: string; p: number }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(80px, 180px) 1fr 52px",
        alignItems: "center",
        gap: 10,
        fontSize: 13,
      }}
    >
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={label}>
        {label}
      </span>
      <span style={{ height: 8, background: "var(--bg-hover)", borderRadius: 4, overflow: "hidden" }}>
        <span
          style={{
            display: "block",
            height: "100%",
            width: `${Math.max(0, Math.min(1, p)) * 100}%`,
            background: "var(--accent)",
          }}
        />
      </span>
      <span style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{pct(p)}</span>
    </div>
  );
}
