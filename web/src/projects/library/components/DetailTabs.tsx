"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { fileSections, fileUrl, getJson } from "../api";
import type { FileKey, ForecastDetail, LiveQuestion, RunEntry } from "../types";
import { Markdown } from "./Markdown";
import { SeriesTable, runColor } from "./DistributionCharts";
import { ValueView, formatDate, formatNumber, pct } from "./Value";
import {
  Collapsible,
  Faint,
  Field,
  Muted,
  Notice,
  RunDot,
  Section,
  Tag,
  buttonStyle,
  cellStyle,
  numStyle,
} from "./ui";

/** Prose reads best at ~75 characters a line; tables keep the full width. */
const prose = { maxWidth: "78ch" } as const;

export type TabKey = "models" | "evidence" | "question" | "cost" | "files";

export const TABS: { key: TabKey; label: string }[] = [
  { key: "models", label: "Models" },
  { key: "evidence", label: "Evidence" },
  { key: "question", label: "Question" },
  { key: "cost", label: "Cost" },
  { key: "files", label: "Files" },
];

/**
 * Everything behind the glance card, one topic at a time. The selected tab is
 * owned by the caller so it survives switching forecasts. Panels mount only
 * when opened, so a file is fetched only when someone asks for it.
 */
export function DetailTabs({
  detail: d,
  unit,
  tab,
  onTab,
}: {
  detail: ForecastDetail;
  unit: string;
  tab: TabKey;
  onTab: (tab: TabKey) => void;
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  // Roving focus: arrows move between tabs and select, as the ARIA tabs pattern does.
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = TABS.findIndex((t) => t.key === tab);
    const next =
      e.key === "ArrowRight" ? (i + 1) % TABS.length
      : e.key === "ArrowLeft" ? (i - 1 + TABS.length) % TABS.length
      : e.key === "Home" ? 0
      : e.key === "End" ? TABS.length - 1
      : null;
    if (next === null) return;
    e.preventDefault();
    onTab(TABS[next].key);
    refs.current[TABS[next].key]?.focus();
  };

  const badge: Partial<Record<TabKey, string>> = {
    models: `${d.runs.filter((r) => !r.dropped).length}/${d.runs.length}`,
    evidence: d.artifactCheck?.status,
  };

  return (
    <div style={{ marginTop: 24 }}>
      <div
        role="tablist"
        aria-label="Forecast details"
        onKeyDown={onKey}
        // The rule is an inset shadow, not a border, so tabs can overlap it without overflowing.
        style={{ display: "flex", gap: 2, boxShadow: "inset 0 -1px 0 var(--border)", overflowX: "auto", overflowY: "hidden" }}
      >
        {TABS.map(({ key, label }) => {
          const active = key === tab;
          return (
            <button
              key={key}
              ref={(el) => { refs.current[key] = el; }}
              role="tab"
              id={`tab-${key}`}
              aria-selected={active}
              aria-controls={`panel-${key}`}
              tabIndex={active ? 0 : -1}
              onClick={() => onTab(key)}
              style={{
                padding: "8px 14px",
                border: "none",
                borderBottom: `2px solid ${active ? "var(--accent)" : "transparent"}`,
                background: "transparent",
                cursor: "pointer",
                fontSize: 13.5,
                fontWeight: active ? 600 : 450,
                color: active ? "var(--text)" : "var(--text-muted)",
                whiteSpace: "nowrap",
              }}
            >
              {label}
              {badge[key] && (
                <span style={{ marginLeft: 6, fontSize: 11.5, color: "var(--text-faint)", fontWeight: 450 }}>{badge[key]}</span>
              )}
            </button>
          );
        })}
      </div>

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} style={{ paddingTop: 4 }}>
        {tab === "models" && <ModelsPanel detail={d} unit={unit} />}
        {tab === "evidence" && <EvidencePanel detail={d} />}
        {tab === "question" && <QuestionPanel detail={d} unit={unit} />}
        {tab === "cost" && <CostPanel detail={d} />}
        {tab === "files" && <FilesPanel runId={d.runId} questionId={d.questionId} />}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ models */

function ModelCell({ run }: { run: RunEntry }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", flexWrap: "wrap", gap: 2 }}>
      <RunDot color={run.dropped ? null : runColor(run.index)} />
      <span style={{ color: "var(--text-faint)", marginRight: 4 }}>{run.index}</span>
      <code style={{ fontFamily: "var(--font-mono)", fontSize: 12.5 }}>{run.model}</code>
      {run.dropped && <Tag tone="warn">dropped</Tag>}
      {run.repaired && <Tag>repaired</Tag>}
      {run.flags.map((f) => <Tag key={f} tone="warn">{f}</Tag>)}
    </span>
  );
}

function ModelsPanel({ detail: d, unit }: { detail: ForecastDetail; unit: string }) {
  if (!d.runs.length) return <Section><Faint>No ensemble recorded (schema v{d.schemaVersion}).</Faint></Section>;

  // Numeric / discrete: quantiles per run, then each run's mixture on demand.
  if (d.curves) {
    return (
      <>
        <Section title="Each model's distribution">
          <SeriesTable curves={d.curves} unit={unit} />
          {d.runs.some((r) => r.dropped) && (
            <Faint style={{ marginTop: 8 }}>
              Dropped and excluded from the blend: {d.runs.filter((r) => r.dropped).map((r) => `run ${r.index} (${r.model})`).join(", ")}.
            </Faint>
          )}
        </Section>
        <Section title="What each model specified">
          {d.runs.filter((r) => !r.dropped).map((run) => (
            <Collapsible key={run.index} label={<ModelCell run={run} />}>
              <ValueView value={run.value} unit={unit} />
            </Collapsible>
          ))}
        </Section>
      </>
    );
  }

  // Binary / multiple choice: one table, a column per answer.
  const finalOptions = d.final?.kind === "mc" ? d.final.options : null;
  const columns = finalOptions
    ? Object.keys(finalOptions).sort((a, b) => finalOptions[b] - finalOptions[a])
    : ["Yes"];
  const valueOf = (v: RunEntry["value"] | ForecastDetail["final"], column: string) =>
    !v ? null : v.kind === "binary" ? v.p : v.kind === "mc" ? v.options[column] ?? null : null;

  return (
    <Section>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", fontSize: 13, width: "100%" }}>
          <thead>
            <tr style={{ color: "var(--text-muted)", textAlign: "left" }}>
              <th style={cellStyle}>Model</th>
              {columns.map((c) => <th key={c} style={{ ...numStyle, maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis" }} title={c}>{c}</th>)}
            </tr>
          </thead>
          <tbody>
            <tr style={{ fontWeight: 600 }}>
              <td style={cellStyle}>Submitted</td>
              {columns.map((c) => {
                const v = valueOf(d.final, c);
                return <td key={c} style={numStyle}>{v == null ? "—" : pct(v)}</td>;
              })}
            </tr>
            {d.runs.map((run) => (
              <tr key={run.index} style={{ opacity: run.dropped ? 0.55 : 1 }}>
                <td style={{ ...cellStyle, whiteSpace: "normal" }}><ModelCell run={run} /></td>
                {columns.map((c) => {
                  const v = valueOf(run.value, c);
                  return <td key={c} style={numStyle}>{run.dropped ? "—" : v == null ? "—" : pct(v)}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Faint style={{ marginTop: 8 }}>
        {d.type === "binary" ? "Submitted is the median of the models." : "Submitted is the mean of the models."}
      </Faint>
    </Section>
  );
}

/* ---------------------------------------------------------------- evidence */

function EvidencePanel({ detail: d }: { detail: ForecastDetail }) {
  const a = d.artifactCheck;
  const [brief, setBrief] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getJson<{ text: string | null }>(fileUrl(d.runId, d.questionId, "research"))
      .then(({ text }) => setBrief(text ? fileSections(text, "research").find((s) => s.heading.startsWith("Compiled Brief"))?.body ?? null : null))
      .catch((e: Error) => setError(e.message));
  }, [d.runId, d.questionId]);

  return (
    <div style={prose}>
      <Section title="Evidence check">
        {!a ? (
          <Faint>No evidence check recorded.</Faint>
        ) : (
          <>
            <div style={{ fontSize: 13, marginBottom: 12 }}>
              <Tag tone={a.status === "complete" ? undefined : "warn"}>{a.status ?? "unknown"}</Tag>
              {a.forecast_swing && <Muted> · if the missing evidence turned up, the forecast could swing: {a.forecast_swing}</Muted>}
            </div>
            {a.what_was_found && <Field label="Found">{a.what_was_found}</Field>}
            {a.what_is_missing && <Field label="Missing">{a.what_is_missing}</Field>}
            {a.closest_available && <Field label="Closest available">{a.closest_available}</Field>}
          </>
        )}
        {!!d.degradedProviders.length && <Field label="Degraded search providers">{d.degradedProviders.join(", ")}</Field>}
      </Section>
      <Section title="Research brief given to the models">
        {error && <Notice tone="warn">{error}</Notice>}
        {brief === undefined && !error && <Faint>Loading…</Faint>}
        {brief === null && <Faint>No compiled brief in this run&apos;s research file.</Faint>}
        {brief && (
          <div style={{ fontSize: 13.5 }}>
            <Markdown>{brief}</Markdown>
          </div>
        )}
        <Faint style={{ marginTop: 8 }}>The raw research from each provider is under Files → Research.</Faint>
      </Section>
    </div>
  );
}

/* ---------------------------------------------------------------- question */

function QuestionPanel({ detail: d, unit }: { detail: ForecastDetail; unit: string }) {
  return (
    <div style={prose}>
      <Section title="Resolution criteria">
        <div style={{ fontSize: 13.5 }}>
          <Markdown>{d.question.resolutionCriteria || "_none recorded_"}</Markdown>
        </div>
      </Section>
      {d.question.fineprint && (
        <Collapsible label="Fine print"><Markdown>{d.question.fineprint}</Markdown></Collapsible>
      )}
      {d.question.description && (
        <Collapsible label="Background"><Markdown>{d.question.description}</Markdown></Collapsible>
      )}
      <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 8 }}>
        Closes {formatDate(d.question.closeTime)} · resolves {formatDate(d.question.resolveTime)} · as recorded when the bot ran
      </div>
      {d.postId && <Live postId={d.postId} unit={unit} />}
    </div>
  );
}

function Live({ postId, unit }: { postId: number; unit: string }) {
  const [live, setLive] = useState<LiveQuestion | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState("");

  // On demand, never on load: Metaculus wants ~3s between requests (handoff §6).
  const load = () => {
    setState("loading");
    getJson<LiveQuestion>(`view=live&post=${postId}`)
      .then((value) => { setLive(value); setState("idle"); })
      .catch((e: Error) => { setError(e.message); setState("error"); });
  };

  return (
    <Section
      title="On Metaculus now"
      action={
        <button onClick={load} disabled={state === "loading"} style={buttonStyle}>
          {state === "loading" ? "Fetching…" : live ? "Refresh" : "Fetch live"}
        </button>
      }
    >
      {state === "error" && <Notice tone="warn">{error}</Notice>}
      {!live && state !== "error" && <Faint>Current status and community forecast, from the Metaculus API.</Faint>}
      {live && (
        <>
          <div style={{ fontSize: 13, display: "flex", flexWrap: "wrap", gap: "4px 16px", marginBottom: 10 }}>
            <span><Muted>Status</Muted> {live.status ?? "—"}</span>
            {live.resolution && <span><Muted>Resolution</Muted> {live.resolution}</span>}
            <span><Muted>Forecasters</Muted> {live.forecasters ?? "—"}</span>
            <span><Muted>Closes</Muted> {formatDate(live.closeTime)}</span>
          </div>
          {live.community ? (
            <ValueView value={live.community} unit={unit} />
          ) : (
            <Faint>
              No community forecast returned for this token
              {live.cpRevealTime && new Date(live.cpRevealTime) > new Date()
                ? ` — hidden until ${formatDate(live.cpRevealTime)}.`
                : ". Bot accounts are typically shown no aggregate on tournament questions."}
            </Faint>
          )}
          <Faint style={{ marginTop: 8 }}>
            Fetched {formatDate(live.fetchedAt)}{live.cached ? " (cached)" : ""}
          </Faint>
        </>
      )}
    </Section>
  );
}

/* -------------------------------------------------------------------- cost */

function CostPanel({ detail: d }: { detail: ForecastDetail }) {
  const t = d.timings;
  return (
    <Section>
      {t?.total_seconds != null && (
        <div style={{ fontSize: 13, marginBottom: 10 }}>
          <Muted>Time</Muted> {Math.round(t.total_seconds)}s
          {t.research_seconds != null && <Muted> · research {Math.round(t.research_seconds)}s · forecast {Math.round(t.forecast_seconds ?? 0)}s</Muted>}
        </div>
      )}
      {d.cost.length ? (
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", fontSize: 12.5, width: "100%" }}>
            <thead>
              <tr style={{ color: "var(--text-muted)", textAlign: "left" }}>
                <th style={cellStyle}>Model</th>
                <th style={cellStyle}>Source</th>
                {["Calls", "USD", "Quota µ$", "Tokens in / out"].map((h) => <th key={h} style={numStyle}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {d.cost.map((c) => (
                <tr key={`${c.model}|${c.source}`}>
                  <td style={cellStyle}><code style={{ fontFamily: "var(--font-mono)" }}>{c.model}</code></td>
                  <td style={cellStyle}>{c.source}</td>
                  <td style={numStyle}>{c.calls}</td>
                  <td style={numStyle}>{c.usd ? `$${c.usd.toFixed(4)}` : "—"}</td>
                  <td style={numStyle}>{c.quotaMicro ? formatNumber(c.quotaMicro) : "—"}</td>
                  <td style={numStyle}>{formatNumber(c.inputTokens)} / {formatNumber(c.outputTokens)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Faint>No per-call records.</Faint>
      )}
      <Faint style={{ marginTop: 8 }}>
        &quot;native&quot; and &quot;price_table&quot; rows are real dollars; &quot;quota&quot; rows are SoCLaaS allowance, never added to them.
      </Faint>
    </Section>
  );
}

/* ------------------------------------------------------------------- files */

const FILE_TABS: { key: FileKey; label: string }[] = [
  { key: "research", label: "Research" },
  { key: "runs", label: "Runs" },
  { key: "evolution", label: "Evolution" },
  { key: "audit", label: "Audit" },
];

function FilesPanel({ runId, questionId }: { runId: string; questionId: number }) {
  const [file, setFile] = useState<FileKey>("research");
  const [texts, setTexts] = useState<Partial<Record<FileKey, string | null>>>({});
  const [errors, setErrors] = useState<Partial<Record<FileKey, string>>>({});

  // A failed file retries when it is selected again; errors are deliberately not a dependency.
  useEffect(() => {
    if (file in texts) return;
    getJson<{ text: string | null }>(fileUrl(runId, questionId, file))
      .then(({ text }) => {
        setTexts((t) => ({ ...t, [file]: text }));
        setErrors(({ [file]: _, ...rest }) => rest); // eslint-disable-line @typescript-eslint/no-unused-vars
      })
      .catch((e: Error) => setErrors((all) => ({ ...all, [file]: e.message })));
  }, [file, texts, runId, questionId]);

  const text = texts[file];
  const error = errors[file];
  const parts = useMemo(() => (text ? fileSections(text, file) : []), [text, file]);

  const openByDefault = (heading: string) =>
    file === "research" ? heading.startsWith("Compiled Brief")
    : file === "runs" ? heading.startsWith("Run ")
    : true;

  return (
    <Section>
      <div style={{ display: "flex", gap: 4, marginBottom: 12, flexWrap: "wrap" }}>
        {FILE_TABS.map(({ key, label }) => (
          <button
            key={key}
            aria-pressed={file === key}
            onClick={() => setFile(key)}
            style={{ ...buttonStyle, background: file === key ? "var(--bg-active)" : "transparent" }}
          >
            {label}
          </button>
        ))}
      </div>
      {error && <Notice tone="warn">{error}</Notice>}
      {!error && !(file in texts) && <Faint>Loading…</Faint>}
      {text === null && <Faint>Not produced for this run.</Faint>}
      {parts.map((part, i) =>
        part.heading ? (
          <Collapsible key={`${file}-${i}`} label={part.heading} defaultOpen={openByDefault(part.heading)}>
            <Markdown>{part.body}</Markdown>
          </Collapsible>
        ) : (
          <div key={`${file}-${i}`} style={{ marginBottom: 10 }}><Markdown>{part.body}</Markdown></div>
        ),
      )}
    </Section>
  );
}
