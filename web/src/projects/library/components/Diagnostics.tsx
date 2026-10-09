"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { fileUrl, getJson } from "../api";
import { DIAGNOSTIC_STATUSES, type DiagnosticCheck, type DiagnosticsSummary } from "../types";
import { Markdown } from "./Markdown";
import { formatDate, formatNumber, pct } from "./Value";
import { Faint, Notice, Section, Tag, cellStyle, numStyle } from "./ui";

/**
 * Run diagnostics (diagnostics addendum): the bot's post-run checklist, one row
 * per check. Rendered generically — title, status, detail, evidence — so checks
 * added later appear without code changes; a few `value` shapes get a chart.
 */

/* Status colours: reserved for status, each shown with an icon AND a word, never colour alone. */
export function statusCss(scope: string): string {
  return `
    ${scope} {
      --st-fail: #c62828; --st-fail-bg: #fdecec;
      --st-warn: #a35f00; --st-warn-bg: #fff4e0;
      --st-pass: #2e7d32; --st-pass-bg: #e9f5ea;
      --st-info: #2b5cff; --st-info-bg: #eef2ff;
      --st-skipped: #7a7a84; --st-skipped-bg: #f1f1f3;
    }
    @media (prefers-color-scheme: dark) {
      ${scope} {
        --st-fail: #ff7b72; --st-fail-bg: #3a1d1d;
        --st-warn: #e3b341; --st-warn-bg: #3a2e14;
        --st-pass: #56d364; --st-pass-bg: #16301c;
        --st-info: #7b9bff; --st-info-bg: #1c2340;
        --st-skipped: #8b8b96; --st-skipped-bg: #23232a;
      }
    }`;
}

const ICONS: Record<string, string> = { fail: "✕", warn: "!", info: "i", pass: "✓", skipped: "–" };
const known = (status: string) => ((DIAGNOSTIC_STATUSES as readonly string[]).includes(status) ? status : "info");

export function StatusBadge({ status }: { status: string }) {
  const s = known(status);
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "0 7px",
        borderRadius: 10,
        fontSize: 11.5,
        lineHeight: "18px",
        fontWeight: 600,
        color: `var(--st-${s})`,
        background: `var(--st-${s}-bg)`,
        whiteSpace: "nowrap",
        flexShrink: 0,
      }}
    >
      <span aria-hidden>{ICONS[s]}</span>
      {status}
    </span>
  );
}

/** "2 fail · 9 warn" for the forecast list; only the counts that are non-zero. */
export function DiagnosticsBadge({ summary }: { summary: DiagnosticsSummary }) {
  const parts = [
    summary.fails ? { s: "fail", n: summary.fails } : null,
    summary.warns ? { s: "warn", n: summary.warns } : null,
  ].filter(Boolean) as { s: string; n: number }[];
  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }} title={`Diagnosed ${formatDate(summary.diagnosedAt)}`}>
      {parts.length ? (
        parts.map(({ s, n }) => (
          <span key={s} style={{ color: `var(--st-${s})`, fontWeight: 600 }}>
            <span aria-hidden>{ICONS[s]}</span> {n} {s}
          </span>
        ))
      ) : (
        <span style={{ color: "var(--st-pass)", fontWeight: 600 }}>
          <span aria-hidden>✓</span> diagnosed
        </span>
      )}
    </span>
  );
}

const CATEGORY_ORDER = ["pipeline", "sources", "condensation", "evidence", "forecast", "error", "qwen"];
const CATEGORY_LABELS: Record<string, string> = {
  pipeline: "Pipeline",
  sources: "Sources",
  condensation: "Condensation",
  evidence: "Evidence",
  forecast: "Forecast",
  error: "Checks that crashed",
  qwen: "AI-assisted checks",
};

export function DiagnosticsPanel({
  runId,
  questionId,
  summary,
}: {
  runId: string;
  questionId: number;
  summary: DiagnosticsSummary | null;
}) {
  const [checks, setChecks] = useState<DiagnosticCheck[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    getJson<{ checks: DiagnosticCheck[] }>(`view=diagnostics&run=${encodeURIComponent(runId)}&q=${questionId}`)
      .then(({ checks }) => setChecks(checks))
      .catch((e: Error) => setError(e.message));
  }, [runId, questionId]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const check of checks ?? []) c[known(check.status)] = (c[known(check.status)] ?? 0) + 1;
    return c;
  }, [checks]);

  const groups = useMemo(() => {
    const visible = (checks ?? []).filter((c) => !hidden.has(known(c.status)));
    const byCategory = new Map<string, DiagnosticCheck[]>();
    for (const c of visible) byCategory.set(c.category, [...(byCategory.get(c.category) ?? []), c]);
    const order = (cat: string) => (CATEGORY_ORDER.includes(cat) ? CATEGORY_ORDER.indexOf(cat) : CATEGORY_ORDER.length);
    return [...byCategory.entries()].sort((a, b) => order(a[0]) - order(b[0]) || a[0].localeCompare(b[0]));
  }, [checks, hidden]);

  const toggle = (status: string) =>
    setHidden((current) => {
      const next = new Set(current);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });

  if (error) return <Notice tone="warn">{error}</Notice>;
  if (!checks) return <Section><Faint>Loading diagnostics…</Faint></Section>;
  if (!checks.length) return <Section><Faint>This forecast has not been diagnosed.</Faint></Section>;

  const diagnosedAt = summary?.diagnosedAt ?? checks.map((c) => c.diagnosedAt).filter(Boolean).sort().at(-1) ?? null;

  return (
    <>
      <Section>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
          {DIAGNOSTIC_STATUSES.filter((s) => counts[s]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => toggle(s)}
              aria-pressed={!hidden.has(s)}
              title={hidden.has(s) ? `Show ${s}` : `Hide ${s}`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "3px 10px",
                borderRadius: 14,
                border: `1px solid ${hidden.has(s) ? "var(--border)" : `var(--st-${s})`}`,
                background: hidden.has(s) ? "transparent" : `var(--st-${s}-bg)`,
                color: hidden.has(s) ? "var(--text-faint)" : `var(--st-${s})`,
                cursor: "pointer",
                fontSize: 12.5,
                fontWeight: 600,
              }}
            >
              <span aria-hidden>{ICONS[s]}</span> {counts[s]} {s}
            </button>
          ))}
          <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--text-faint)" }}>Diagnosed {formatDate(diagnosedAt)}</span>
        </div>
        <Faint style={{ marginTop: 6 }}>
          Click a count to hide or show it. Checks tagged AI-assisted were extracted by Qwen and verified by code — less
          certain than measured ones.
        </Faint>
      </Section>

      {groups.map(([category, list]) => (
        <Section key={category} title={`${CATEGORY_LABELS[category] ?? category} · ${list.length}`}>
          <div style={{ border: "1px solid var(--border)", borderRadius: "var(--radius)" }}>
            {list.map((check, i) => (
              <CheckRow key={check.checkId} check={check} first={i === 0} />
            ))}
          </div>
        </Section>
      ))}
      {!groups.length && <Section><Faint>Every status is hidden.</Faint></Section>}

      <Section>
        <FullReport runId={runId} questionId={questionId} />
      </Section>
    </>
  );
}

function CheckRow({ check, first }: { check: DiagnosticCheck; first: boolean }) {
  const status = known(check.status);
  const hasMore = check.evidence.length > 0 || check.value != null;
  // Fails open by default: they are what the reader came to see.
  const [open, setOpen] = useState(status === "fail" && hasMore);
  const crashed = check.checkId.startsWith("error.");

  return (
    <div style={{ borderTop: first ? "none" : "1px solid var(--border)" }}>
      <button
        type="button"
        onClick={() => hasMore && setOpen(!open)}
        aria-expanded={hasMore ? open : undefined}
        style={{
          width: "100%",
          display: "grid",
          gridTemplateColumns: "auto 1fr auto",
          gap: 10,
          alignItems: "start",
          padding: "9px 12px",
          border: "none",
          background: "transparent",
          textAlign: "left",
          cursor: hasMore ? "pointer" : "default",
        }}
      >
        <span style={{ paddingTop: 1 }}><StatusBadge status={check.status} /></span>
        <span style={{ minWidth: 0 }}>
          <span style={{ fontSize: 13.5, fontWeight: 550 }}>{check.title}</span>
          {check.method === "qwen" && <Tag>AI-assisted</Tag>}
          {check.detail && (
            <span style={{ display: "block", fontSize: 12.5, color: crashed ? "var(--text-faint)" : "var(--text-muted)", marginTop: 2, lineHeight: 1.45 }}>
              {check.detail}
            </span>
          )}
        </span>
        {hasMore && <span aria-hidden style={{ fontSize: 10, color: "var(--text-faint)", paddingTop: 4, transform: open ? "rotate(90deg)" : "none" }}>▶</span>}
      </button>
      {open && (
        <div style={{ padding: "0 12px 12px 12px", marginLeft: 4 }}>
          <ValueView check={check} />
          {check.evidence.length > 0 && (
            <ul
              style={{
                margin: "6px 0 0",
                padding: "8px 10px 8px 26px",
                background: "var(--bg-subtle)",
                borderRadius: 6,
                fontSize: 12,
                lineHeight: 1.55,
                fontFamily: "var(--font-mono)",
                color: "var(--text-muted)",
                overflowX: "auto",
              }}
            >
              {check.evidence.map((line, i) => (
                <li key={i} style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{line}</li>
              ))}
            </ul>
          )}
          <div style={{ marginTop: 6, fontSize: 11, color: "var(--text-faint)" }}>
            <code>{check.checkId}</code> · {check.method === "qwen" ? "AI-assisted" : "measured"}
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ value views */

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const isObj = (v: unknown): v is Row => !!v && typeof v === "object" && !Array.isArray(v);
const asNum = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** The value shapes addendum §6 calls out get a chart; any other value is available as JSON. */
function ValueView({ check }: { check: DiagnosticCheck }) {
  const v = check.value;
  if (v == null) return null;
  // Each chart checks the fields it reads and renders nothing for an unexpected
  // shape, leaving the raw JSON below as the fallback.
  const Chart = CHARTS[check.checkId];
  const chart = Chart ? <Chart v={v} /> : null;
  return (
    <>
      {chart}
      <details style={{ marginTop: chart ? 8 : 0 }}>
        <summary style={{ fontSize: 12, color: "var(--text-faint)", cursor: "pointer" }}>Raw value</summary>
        <pre style={{ fontSize: 11.5, fontFamily: "var(--font-mono)", background: "var(--bg-subtle)", padding: 8, borderRadius: 6, margin: "4px 0 0", maxHeight: 280 }}>
          {JSON.stringify(v, null, 2)}
        </pre>
      </details>
    </>
  );
}

const CHARTS: Record<string, (props: { v: unknown }) => ReactNode> = {
  "condensation.survival": Survival,
  "condensation.compiler_fit": CompilerFit,
  "condensation.boilerplate": Boilerplate,
  "pipeline.cost_time": CostTime,
  "evidence.attribution": Attribution,
  "evidence.history_rows": HistoryRows,
};

function Meter({ share, tone = "info" }: { share: number | null; tone?: string }) {
  const w = share == null ? 0 : Math.max(0, Math.min(1, share));
  return (
    <span style={{ display: "inline-block", width: 90, height: 7, borderRadius: 4, background: "var(--bg-hover)", verticalAlign: "middle", overflow: "hidden" }}>
      <span style={{ display: "block", height: "100%", width: `${w * 100}%`, background: `var(--st-${tone})` }} />
    </span>
  );
}

function MiniTable({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ borderCollapse: "collapse", fontSize: 12.5, width: "100%" }}>
        <thead>
          <tr style={{ color: "var(--text-muted)", textAlign: "left" }}>
            {head.map((h, i) => <th key={h} style={i === 0 ? cellStyle : numStyle}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>{r.map((c, j) => <td key={j} style={j === 0 ? { ...cellStyle, whiteSpace: "normal" } : numStyle}>{c}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** research → brief-writer input → brief: how many numbers and sources survive each step. */
function Survival({ v }: { v: unknown }) {
  const stages: Row[] = isObj(v) && Array.isArray(v.stages) ? v.stages : [];
  if (!stages.length) return null;
  return (
    <MiniTable
      head={["Stage", "Numbers kept", "", "Sources kept", ""]}
      rows={stages.map((s) => [
        `${s.from ?? "?"} → ${s.to ?? "?"}`,
        <span key="n">{s.numbers ?? ""}{asNum(s.numbers_kept) != null && ` (${pct(s.numbers_kept)})`}</span>,
        <Meter key="nm" share={asNum(s.numbers_kept)} />,
        <span key="s">{s.sources ?? ""}{asNum(s.sources_kept) != null && ` (${pct(s.sources_kept)})`}</span>,
        <Meter key="sm" share={asNum(s.sources_kept)} />,
      ])}
    />
  );
}

/** How much of each research section the brief writer's budget let through. */
function CompilerFit({ v }: { v: unknown }) {
  const sections: Row[] = isObj(v) && Array.isArray(v.sections) ? v.sections : [];
  if (!sections.length) return null;
  return (
    <MiniTable
      head={["Section", "Before", "After", "Kept", ""]}
      rows={sections.map((s) => {
        const kept = asNum(s.kept);
        return [
          String(s.section ?? "?"),
          formatNumber(asNum(s.before)),
          formatNumber(asNum(s.after)),
          kept == null ? "—" : pct(kept),
          <Meter key="m" share={kept} tone={kept != null && kept < 0.5 ? "warn" : "info"} />,
        ];
      })}
    />
  );
}

function Boilerplate({ v }: { v: unknown }) {
  const stages: Row[] = isObj(v) && Array.isArray(v.stages) ? v.stages : [];
  if (!stages.length) return null;
  return (
    <MiniTable
      head={["Stage", "Boilerplate", "", "Lines"]}
      rows={stages.map((s) => {
        const share = asNum(s.boilerplate_share);
        return [String(s.stage ?? "?"), share == null ? "—" : pct(share), <Meter key="m" share={share} tone="warn" />, formatNumber(asNum(s.lines))];
      })}
    />
  );
}

/** Real dollars and quota kept apart, as everywhere else in the library (handoff §5.2). */
function CostTime({ v }: { v: unknown }) {
  if (!isObj(v)) return null;
  const timings = isObj(v.timings) ? Object.entries(v.timings) : [];
  const byStage = isObj(v.paid_by_stage) ? Object.entries(v.paid_by_stage) : [];
  return (
    <div style={{ fontSize: 12.5, display: "grid", gap: 6 }}>
      <div>
        Real spend <strong>{asNum(v.paid_usd) != null ? `$${v.paid_usd.toFixed(4)}` : "—"}</strong>
        {" · "}quota <strong>{formatNumber(asNum(v.quota_microdollars))}</strong> µ$
      </div>
      {timings.length > 0 && (
        <div style={{ color: "var(--text-muted)" }}>
          {timings.map(([k, t]) => `${k.replace(/_seconds$/, "")} ${asNum(t) != null ? `${Math.round(t as number)}s` : String(t)}`).join(" · ")}
        </div>
      )}
      {byStage.length > 0 && (
        <MiniTable head={["Stage", "Paid USD"]} rows={byStage.map(([k, usd]) => [k, asNum(usd) != null ? `$${(usd as number).toFixed(4)}` : String(usd)])} />
      )}
    </div>
  );
}

/** Each brief evidence item traced to its source host and research task. */
function Attribution({ v }: { v: unknown }) {
  const items: Row[] = isObj(v) && Array.isArray(v.items) ? v.items : [];
  if (!items.length) return null;
  const list = (x: unknown) => (Array.isArray(x) && x.length ? x.join(", ") : "—");
  return (
    <MiniTable
      head={["Item", "Sources", "Research tasks", "Sections"]}
      rows={items.map((it) => [
        <strong key="i">{String(it.item ?? "?")}</strong>,
        <span key="h" style={{ whiteSpace: "normal" }}>{list(it.hosts)}</span>,
        <span key="t" style={{ whiteSpace: "normal" }}>{list(it.tasks)}</span>,
        <span key="s" style={{ whiteSpace: "normal" }}>{list(it.sections)}</span>,
      ])}
    />
  );
}

/** Which historical years the research found, and which reached the brief. */
function HistoryRows({ v }: { v: unknown }) {
  if (!isObj(v)) return null;
  const research: unknown[] = Array.isArray(v.research_years) ? v.research_years : [];
  const brief = new Set((Array.isArray(v.brief_years) ? v.brief_years : []).map(String));
  if (!research.length && !brief.size) return null;
  const years = [...new Set([...research.map(String), ...brief])].sort();
  return (
    <div style={{ fontSize: 12.5 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {years.map((y) => {
          const used = brief.has(y);
          return (
            <span
              key={y}
              title={used ? "in the research and the brief" : "found in research, not used in the brief"}
              style={{
                padding: "1px 7px",
                borderRadius: 10,
                fontVariantNumeric: "tabular-nums",
                background: used ? "var(--st-pass-bg)" : "var(--bg-hover)",
                color: used ? "var(--st-pass)" : "var(--text-muted)",
                textDecoration: used ? "none" : "line-through",
              }}
            >
              {y}
            </span>
          );
        })}
      </div>
      <Faint style={{ marginTop: 4 }}>Struck through: found in the research but not used in the brief.</Faint>
      {Array.isArray(v.denominators) && v.denominators.length > 0 && (
        <div style={{ marginTop: 4, color: "var(--text-muted)" }}>Denominators: {v.denominators.join(", ")}</div>
      )}
    </div>
  );
}

/** diagnostics.md.gz rendered as stored — the bot's own report. */
function FullReport({ runId, questionId }: { runId: string; questionId: number }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || text !== undefined) return;
    getJson<{ text: string | null }>(fileUrl(runId, questionId, "diagnostics"))
      .then(({ text }) => setText(text))
      .catch((e: Error) => setError(e.message));
  }, [open, text, runId, questionId]);

  return (
    <details onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)} style={{ border: "1px solid var(--border)", borderRadius: "var(--radius)" }}>
      <summary style={{ padding: "8px 12px", cursor: "pointer", fontSize: 13, fontWeight: 500 }}>Full report (diagnostics.md)</summary>
      <div style={{ padding: "4px 14px 12px", fontSize: 13.5, overflowX: "auto" }}>
        {error && <Notice tone="warn">{error}</Notice>}
        {open && text === undefined && !error && <Faint>Loading…</Faint>}
        {text === null && <Faint>No stored report for this run.</Faint>}
        {text && <Markdown>{text}</Markdown>}
      </div>
    </details>
  );
}

