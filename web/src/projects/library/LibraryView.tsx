"use client";

import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { Markdown } from "./components/Markdown";
import { ValueView, formatDate, formatNumber, valueSummary } from "./components/Value";
import type { FileKey, ForecastDetail, LibraryItem, LiveQuestion } from "./types";

const API = "/api/projects/library";

async function getJson<T>(query: string): Promise<T> {
  const response = await fetch(`${API}?${query}`);
  const body = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
  return body as T;
}

const keyOf = (item: { runId: string; questionId: number }) => `${item.runId}|${item.questionId}`;

export default function LibraryView() {
  const [items, setItems] = useState<LibraryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [submittedOnly, setSubmittedOnly] = useState(false);

  useEffect(() => {
    getJson<{ items: LibraryItem[] }>("view=list")
      .then(({ items }) => {
        setItems(items);
        if (items.length) setSelected((current) => current ?? keyOf(items[0]));
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return (items ?? []).filter(
      (i) =>
        (!submittedOnly || i.submitted) &&
        (!needle ||
          i.title.toLowerCase().includes(needle) ||
          String(i.questionId).includes(needle) ||
          i.runId.includes(needle)),
    );
  }, [items, filter, submittedOnly]);

  const current = items?.find((i) => keyOf(i) === selected) ?? null;

  return (
    <div className="lib">
      <aside className="lib-list">
        <div style={{ padding: "16px 14px 10px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ fontWeight: 600 }}>Forecast library</div>
          <div style={{ color: "var(--text-muted)", fontSize: 12.5 }}>
            {items ? `${items.length} forecasts · ${new Set(items.map((i) => i.questionId)).size} questions` : "Loading…"}
          </div>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by title, question or run"
            aria-label="Filter forecasts"
            style={{
              width: "100%",
              marginTop: 10,
              padding: "6px 10px",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
              background: "var(--bg)",
            }}
          />
          <label style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 8, fontSize: 12.5, color: "var(--text-muted)" }}>
            <input type="checkbox" checked={submittedOnly} onChange={(e) => setSubmittedOnly(e.target.checked)} />
            Submitted only
          </label>
        </div>

        {error && <Notice tone="warn">{error}</Notice>}

        <div style={{ overflowY: "auto", flex: 1 }}>
          {visible.map((item) => {
            const active = keyOf(item) === selected;
            return (
              <button
                key={keyOf(item)}
                onClick={() => setSelected(keyOf(item))}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "10px 14px",
                  border: "none",
                  borderBottom: "1px solid var(--border)",
                  background: active ? "var(--bg-active)" : "transparent",
                  cursor: "pointer",
                }}
              >
                <div style={{ fontSize: 13.5, lineHeight: 1.35 }}>{item.title}</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4, fontSize: 12, color: "var(--text-muted)" }}>
                  <span style={{ color: "var(--text)", fontWeight: 600 }}>{valueSummary(item.final, item.unit)}</span>
                  <span>{item.type.replace("_", " ")}</span>
                  <span>{item.runAt?.slice(0, 10)}</span>
                  {!item.submitted && <span style={{ color: "var(--warn-text)" }}>not submitted</span>}
                  {item.score != null && <span>{item.metric} {item.score.toFixed(3)}</span>}
                </div>
              </button>
            );
          })}
          {items && !visible.length && (
            <div style={{ padding: 14, color: "var(--text-faint)" }}>Nothing matches.</div>
          )}
        </div>
      </aside>

      <main className="lib-detail">
        {current ? (
          <Detail key={keyOf(current)} item={current} />
        ) : (
          !error && <div style={{ padding: 32, color: "var(--text-faint)" }}>{items ? "Select a forecast." : "Loading…"}</div>
        )}
      </main>

      <style>{`
        .lib { display: flex; height: 100%; min-height: 0; }
        .lib-list { width: 340px; flex-shrink: 0; display: flex; flex-direction: column; border-right: 1px solid var(--border); background: var(--bg-subtle); min-height: 0; }
        .lib-detail { flex: 1; min-width: 0; overflow-y: auto; }
        @media (max-width: 800px) {
          .lib { flex-direction: column; overflow-y: auto; }
          .lib-list { width: 100%; max-height: 45vh; border-right: none; border-bottom: 1px solid var(--border); }
          .lib-detail { overflow-y: visible; }
        }
      `}</style>
    </div>
  );
}

/* ------------------------------------------------------------------ detail */

function Detail({ item }: { item: LibraryItem }) {
  const [detail, setDetail] = useState<ForecastDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getJson<ForecastDetail>(`view=forecast&run=${encodeURIComponent(item.runId)}&q=${item.questionId}`)
      .then(setDetail)
      .catch((e: Error) => setError(e.message));
  }, [item.runId, item.questionId]);

  const d = detail;
  const unit = d?.question.unit ?? item.unit;

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "28px 24px 64px" }}>
      <h1 style={{ fontSize: 21, fontWeight: 600, letterSpacing: "-0.01em", margin: 0, lineHeight: 1.3 }}>{item.title}</h1>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px", marginTop: 8, fontSize: 12.5, color: "var(--text-muted)" }}>
        <span>Q{item.questionId}{item.postId ? ` · post ${item.postId}` : ""}</span>
        <span>{item.type.replace("_", " ")}</span>
        <span>{formatDate(item.runAt)}</span>
        <span>{item.workflow}</span>
        <span style={{ color: item.submitted ? "var(--text-muted)" : "var(--warn-text)" }}>
          {item.abstained ? "abstained" : item.submitted ? "submitted" : "not submitted"}
        </span>
        {item.postId && (
          <a href={`https://www.metaculus.com/questions/${item.postId}/`} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)" }}>
            Metaculus ↗
          </a>
        )}
        {d?.runUrl && (
          <a href={d.runUrl} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)" }}>
            GitHub run ↗
          </a>
        )}
      </div>

      {error && <Notice tone="warn">{error}</Notice>}
      {!d && !error && <div style={{ marginTop: 24, color: "var(--text-faint)" }}>Loading…</div>}

      {d && (
        <>
          <Section title="Submitted forecast">
            <ValueView value={d.final} unit={unit} />
            <Outcome detail={d} />
          </Section>

          {item.postId && <Live postId={item.postId} unit={unit} />}

          <Section title={`Ensemble — ${d.runs.filter((r) => !r.dropped).length} of ${d.runs.length} runs used`}>
            {d.runs.length === 0 && <Faint>No ensemble recorded (schema v{d.schemaVersion}).</Faint>}
            <div style={{ display: "grid", gap: 14 }}>
              {d.runs.map((run) => (
                <div key={run.index} style={{ opacity: run.dropped ? 0.6 : 1 }}>
                  <div style={{ fontSize: 12.5, marginBottom: 4 }}>
                    <span style={{ color: "var(--text-faint)" }}>Run {run.index} · </span>
                    <code style={{ fontFamily: "var(--font-mono)" }}>{run.model}</code>
                    {run.dropped && <Tag tone="warn">dropped</Tag>}
                    {run.repaired && <Tag>repaired</Tag>}
                    {run.flags.map((f) => <Tag key={f} tone="warn">{f}</Tag>)}
                  </div>
                  {run.dropped ? <Faint>Excluded from the aggregate.</Faint> : <ValueView value={run.value} unit={unit} />}
                </div>
              ))}
            </div>
          </Section>

          {d.artifactCheck && <ArtifactCheckView detail={d} />}

          <CostView detail={d} />

          <Section title="Question at run time">
            <Faint>A snapshot from when the bot ran — live status is above.</Faint>
            <Collapsible label="Resolution criteria" defaultOpen>
              <Markdown>{d.question.resolutionCriteria || "_none recorded_"}</Markdown>
            </Collapsible>
            {d.question.fineprint && (
              <Collapsible label="Fine print"><Markdown>{d.question.fineprint}</Markdown></Collapsible>
            )}
            {d.question.description && (
              <Collapsible label="Background"><Markdown>{d.question.description}</Markdown></Collapsible>
            )}
            <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 8 }}>
              Closes {formatDate(d.question.closeTime)} · resolves {formatDate(d.question.resolveTime)}
            </div>
          </Section>

          <Files runId={d.runId} questionId={d.questionId} />
        </>
      )}
    </div>
  );
}

function Outcome({ detail: d }: { detail: ForecastDetail }) {
  const o = d.outcome;
  if (!o.status) return <Faint style={{ marginTop: 10 }}>No outcome check yet.</Faint>;
  return (
    <div style={{ marginTop: 12, fontSize: 13 }}>
      <span style={{ color: "var(--text-muted)" }}>Outcome: </span>
      {o.status}
      {o.resolution && <> — resolved <strong>{o.resolution}</strong> {o.resolvedAt && `on ${o.resolvedAt.slice(0, 10)}`}</>}
      {o.score != null && (
        <>
          <span style={{ color: "var(--text-muted)" }}> · {o.metric} </span>
          <strong>{o.score.toFixed(4)}</strong>
          <span style={{ color: "var(--text-faint)" }}> (lower is better)</span>
        </>
      )}
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
      {!live && state !== "error" && <Faint>Status and community forecast, fetched from the Metaculus API.</Faint>}
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
              Metaculus did not return a community forecast for this token
              {live.cpRevealTime && new Date(live.cpRevealTime) > new Date()
                ? ` — it is hidden until ${formatDate(live.cpRevealTime)}.`
                : ". Bot accounts are typically shown no aggregate in tournament questions."}
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

function ArtifactCheckView({ detail: d }: { detail: ForecastDetail }) {
  const a = d.artifactCheck!;
  return (
    <Section title="Evidence check">
      <div style={{ fontSize: 13, marginBottom: 8 }}>
        <Tag tone={a.status === "complete" ? undefined : "warn"}>{a.status ?? "unknown"}</Tag>
        {a.forecast_swing && <Muted> · forecast swing if the missing evidence arrived: {a.forecast_swing}</Muted>}
      </div>
      {a.what_was_found && <Field label="Found">{a.what_was_found}</Field>}
      {a.what_is_missing && <Field label="Missing">{a.what_is_missing}</Field>}
      {a.closest_available && <Field label="Closest available">{a.closest_available}</Field>}
      {!!d.degradedProviders.length && (
        <Field label="Degraded search providers">{d.degradedProviders.join(", ")}</Field>
      )}
    </Section>
  );
}

function CostView({ detail: d }: { detail: ForecastDetail }) {
  const usd = d.cost.reduce((a, c) => a + c.usd, 0);
  const quota = d.cost.reduce((a, c) => a + c.quotaMicro, 0);
  const calls = d.cost.reduce((a, c) => a + c.calls, 0);
  const t = d.timings;
  return (
    <Section title="Cost">
      {/* §5.2: two currencies, reported side by side and never added. */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 20px", fontSize: 13, marginBottom: 10 }}>
        <span><Muted>Real spend</Muted> <strong>${usd.toFixed(4)}</strong></span>
        <span><Muted>SoCLaaS quota</Muted> <strong>{formatNumber(quota)} µ$</strong> <Faint as="span">(allowance, not dollars)</Faint></span>
        <span><Muted>Calls</Muted> {calls}</span>
        {t?.total_seconds != null && (
          <span><Muted>Time</Muted> {Math.round(t.total_seconds)}s{t.research_seconds != null && ` (research ${Math.round(t.research_seconds)}s, forecast ${Math.round(t.forecast_seconds ?? 0)}s)`}</span>
        )}
      </div>
      {!!d.cost.length && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", fontSize: 12.5, width: "100%" }}>
            <thead>
              <tr style={{ color: "var(--text-muted)", textAlign: "left" }}>
                {["Model", "Source", "Calls", "USD", "Quota µ$", "Tokens in / out"].map((h) => (
                  <th key={h} style={cellStyle}>{h}</th>
                ))}
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
      )}
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

/*
 * The structural boundaries of each stored file (handoff §4). Only these split
 * a file: the research and model transcripts embedded inside carry their own
 * `#`/`##` headings, undemoted, so splitting on every `## ` shreds them.
 * research.md: a planning preamble, then the compiled brief, then one section
 * per provider. runs.md: the shared prompt, then one section per run.
 */
const BOUNDARIES: Partial<Record<FileKey, RegExp>> = {
  research: /^(?=## (?:Compiled Brief \(sent to forecaster\)|Provider: .*)\s*$)/m,
  runs: /^(?=## (?:Prompt \(identical for every run\)|Run \d+)\s*$)/m,
};

function sections(text: string, file: FileKey): { heading: string; body: string }[] {
  const boundary = BOUNDARIES[file];
  if (!boundary) return [{ heading: "", body: text }];
  return text
    .split(boundary)
    .map((chunk, i) => {
      const newline = chunk.indexOf("\n");
      const first = newline < 0 ? chunk : chunk.slice(0, newline);
      if (i > 0 || first.startsWith("## ")) {
        return { heading: first.slice(3).trim(), body: newline < 0 ? "" : chunk.slice(newline + 1) };
      }
      return { heading: "Preamble", body: chunk };
    })
    .filter((part) => part.body.trim());
}

function Files({ runId, questionId }: { runId: string; questionId: number }) {
  const [tab, setTab] = useState<FileKey>("research");
  const [texts, setTexts] = useState<Partial<Record<FileKey, string | null>>>({});
  const [errors, setErrors] = useState<Partial<Record<FileKey, string>>>({});

  // A failed tab retries when it is selected again; errors are deliberately not a dependency.
  useEffect(() => {
    if (tab in texts) return;
    getJson<{ text: string | null }>(`view=file&run=${encodeURIComponent(runId)}&q=${questionId}&file=${tab}`)
      .then(({ text }) => {
        setTexts((t) => ({ ...t, [tab]: text }));
        setErrors(({ [tab]: _, ...rest }) => rest); // eslint-disable-line @typescript-eslint/no-unused-vars
      })
      .catch((e: Error) => setErrors((all) => ({ ...all, [tab]: e.message })));
  }, [tab, texts, runId, questionId]);

  const text = texts[tab];
  const error = errors[tab];
  const parts = useMemo(() => (text ? sections(text, tab) : []), [text, tab]);

  // The brief and the runs are what a reader wants; the rest starts folded.
  const openByDefault = (heading: string) =>
    tab === "research" ? heading.startsWith("Compiled Brief")
    : tab === "runs" ? heading.startsWith("Run ")
    : true;

  return (
    <Section title="Files">
      <div role="tablist" style={{ display: "flex", gap: 4, marginBottom: 12, flexWrap: "wrap" }}>
        {FILE_TABS.map(({ key, label }) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            style={{ ...buttonStyle, background: tab === key ? "var(--bg-active)" : "transparent" }}
          >
            {label}
          </button>
        ))}
      </div>
      {error && <Notice tone="warn">{error}</Notice>}
      {!error && !(tab in texts) && <Faint>Loading…</Faint>}
      {text === null && <Faint>Not produced for this run.</Faint>}
      {parts.map((part, i) =>
        part.heading ? (
          <Collapsible key={`${tab}-${i}`} label={part.heading} defaultOpen={openByDefault(part.heading)}>
            <Markdown>{part.body}</Markdown>
          </Collapsible>
        ) : (
          <div key={`${tab}-${i}`} style={{ marginBottom: 10 }}><Markdown>{part.body}</Markdown></div>
        ),
      )}
    </Section>
  );
}

/* --------------------------------------------------------------- primitives */

const buttonStyle = {
  padding: "4px 12px",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius)",
  background: "transparent",
  cursor: "pointer",
  fontSize: 12.5,
} as const;
const cellStyle = { padding: "5px 8px", borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" } as const;
const numStyle = { ...cellStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" } as const;

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section style={{ marginTop: 28 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 10 }}>
        <h2 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Collapsible({ label, defaultOpen = false, children }: { label: string; defaultOpen?: boolean; children: ReactNode }) {
  return (
    <details open={defaultOpen} style={{ border: "1px solid var(--border)", borderRadius: "var(--radius)", marginBottom: 8 }}>
      <summary style={{ padding: "8px 12px", cursor: "pointer", fontSize: 13, fontWeight: 500 }}>{label}</summary>
      <div style={{ padding: "4px 14px 12px", fontSize: 13.5, overflowX: "auto" }}>{children}</div>
    </details>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ fontSize: 13, marginBottom: 8 }}>
      <div style={{ color: "var(--text-muted)", fontSize: 12 }}>{label}</div>
      <div>{children}</div>
    </div>
  );
}

function Tag({ tone, children }: { tone?: "warn"; children: ReactNode }) {
  return (
    <span
      style={{
        display: "inline-block",
        marginLeft: 6,
        padding: "0 7px",
        borderRadius: 10,
        fontSize: 11.5,
        border: `1px solid ${tone === "warn" ? "var(--warn-border)" : "var(--border)"}`,
        background: tone === "warn" ? "var(--warn-bg)" : "var(--bg-subtle)",
        color: tone === "warn" ? "var(--warn-text)" : "var(--text-muted)",
      }}
    >
      {children}
    </span>
  );
}

function Notice({ tone, children }: { tone?: "warn"; children: ReactNode }) {
  return (
    <div
      style={{
        margin: "12px 0",
        padding: "10px 14px",
        borderRadius: "var(--radius)",
        fontSize: 13,
        background: tone === "warn" ? "var(--warn-bg)" : "var(--bg-subtle)",
        border: `1px solid ${tone === "warn" ? "var(--warn-border)" : "var(--border)"}`,
        color: tone === "warn" ? "var(--warn-text)" : "var(--text)",
      }}
    >
      {children}
    </div>
  );
}

function Muted({ children }: { children: ReactNode }) {
  return <span style={{ color: "var(--text-muted)" }}>{children}</span>;
}

function Faint({ children, style, as = "div" }: { children: ReactNode; style?: CSSProperties; as?: "div" | "span" }) {
  const Element = as;
  return <Element style={{ color: "var(--text-faint)", fontSize: 12.5, ...style }}>{children}</Element>;
}

