"use client";

import { useEffect, useState, type ReactNode } from "react";
import { getJson } from "../../api";
import type { LineageCall, LineageNode } from "../../types";
import { Chip, StatusPill, chars, indexLineage, nodeName, seconds, smallButton } from "./shared";

/**
 * One step (LINEAGE.md §6.3): what it was, what fed it and what it fed, the
 * calls it made, and its saved input and output. Fed-by / Feeds links walk the
 * whole pipeline one step at a time. Files load only when the sheet opens.
 */

const PREVIEW = 50_000;

export function StepSheet({
  ix,
  nodeId,
  runId,
  questionId,
  onSelect,
  onClose,
}: {
  ix: ReturnType<typeof indexLineage>;
  nodeId: string;
  runId: string;
  questionId: number;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const n = ix.node.get(nodeId);

  // Escape closes, as overlays do.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!n) return null;
  const calls = ix.callsByNode.get(n.id) ?? [];
  const inChars = n.input?.chars ?? null;
  const outChars = n.output?.chars ?? null;

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.3)", zIndex: 40 }} />
      <aside
        role="dialog"
        aria-label={`Step ${nodeName(n, 80)}`}
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: "min(780px, 100vw)",
          zIndex: 41,
          background: "var(--bg)",
          borderLeft: "1px solid var(--border)",
          boxShadow: "-8px 0 28px rgba(0,0,0,0.18)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div style={{ padding: "14px 18px 12px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                Step {n.seq ?? "—"} · {n.stage} · {n.kind}
                {n.lane && n.lane !== "*" ? ` · ${n.lane}` : ""}
                {n.pass ? ` · ${n.pass}` : ""}
              </div>
              <div style={{ fontSize: 15, fontWeight: 600, marginTop: 2, wordBreak: "break-word" }}>{n.label || n.stage}</div>
            </div>
            <button type="button" onClick={onClose} aria-label="Close step" style={{ ...smallButton, width: 30, padding: 0, height: 28 }}>
              ✕
            </button>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 12px", marginTop: 8, fontSize: 12.5, color: "var(--text-muted)" }}>
            <StatusPill status={n.status} />
            {n.status_raw && n.status_raw !== n.status && <span>bot: {n.status_raw}</span>}
            {n.model && <span>model <code>{n.model}</code></span>}
            {n.duration_s != null && <span>{seconds(n.duration_s)}</span>}
            {n.ts && <span>finished {n.ts.replace("T", " ")}</span>}
            {n.inferred && <span title="Links reconstructed, not recorded (older run)">links inferred</span>}
            {n.dead_end && <span style={{ color: "var(--st-warn)" }}>dead end: nothing read its output</span>}
          </div>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "12px 18px 30px", fontSize: 13 }}>
          {n.error && <Banner tone="fail">{n.error}</Banner>}
          {n.note && <Banner>{n.note}</Banner>}
          {n.gaps.length > 0 && <Banner tone="warn">Declared inputs nothing produced: {n.gaps.join(", ")}</Banner>}
          {n.cuts.map((c, i) => (
            <Banner key={i} tone="warn">
              ✂ kept {chars(c.kept)}
              {c.of ? ` of ${chars(c.of)} chars (${Math.round(((c.kept ?? 0) / c.of) * 100)}%)` : " chars"} — {c.reason}
            </Banner>
          ))}

          <Links title="Fed by" ids={n.parents} ix={ix} onSelect={onSelect} empty="Nothing — this is where the run starts." />
          <Links title="Feeds" ids={n.children} ix={ix} onSelect={onSelect} empty="Nothing read this step's output." />

          {calls.length > 0 && (
            <section style={{ marginTop: 14 }}>
              <h4 style={h4}>Calls</h4>
              {calls.map((c) => <CallLine key={c.id} c={c} />)}
            </section>
          )}

          <section style={{ marginTop: 16 }}>
            <h4 style={h4}>
              Input → output
              {inChars != null && outChars != null && inChars > 0 && (
                <span style={{ fontWeight: 400, color: "var(--text-muted)" }}>
                  {" "}· {chars(inChars)} → {chars(outChars)} chars ({Math.round((outChars / inChars) * 100)}% kept)
                </span>
              )}
            </h4>
            <InputPane n={n} ix={ix} runId={runId} questionId={questionId} />
            <FilePane title="Output" file={n.output?.file ?? null} runId={runId} questionId={questionId} missing="This step saved no output." />
          </section>
        </div>
      </aside>
    </>
  );
}

const h4 = { fontSize: 12.5, fontWeight: 600, margin: "0 0 6px" } as const;

function Banner({ tone, children }: { tone?: "fail" | "warn"; children: ReactNode }) {
  return (
    <div
      style={{
        margin: "0 0 8px",
        padding: "7px 10px",
        borderRadius: 6,
        fontSize: 12.5,
        background: tone ? `var(--st-${tone}-bg)` : "var(--bg-subtle)",
        color: tone ? `var(--st-${tone})` : "var(--text-muted)",
        wordBreak: "break-word",
      }}
    >
      {children}
    </div>
  );
}

function Links({ title, ids, ix, onSelect, empty }: { title: string; ids: string[]; ix: ReturnType<typeof indexLineage>; onSelect: (id: string) => void; empty: string }) {
  return (
    <section style={{ marginTop: 10 }}>
      <h4 style={h4}>{title}</h4>
      {ids.length ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
          {ids.map((id) => {
            const p = ix.node.get(id);
            return (
              <Chip key={id} onClick={() => onSelect(id)} title={p?.label ?? id}>
                {nodeName(p, 34)}
              </Chip>
            );
          })}
        </div>
      ) : (
        <div style={{ color: "var(--text-faint)", fontSize: 12.5 }}>{empty}</div>
      )}
    </section>
  );
}

function CallLine({ c }: { c: LineageCall }) {
  const bad = c.failed || (c.status_code ?? 0) >= 400 || !!c.outcome?.trim();
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 10px", padding: "5px 0", borderBottom: "1px solid var(--border)", fontSize: 12.5 }}>
      <span style={{ fontWeight: 600 }}>{c.service ?? "—"}</span>
      <span style={{ color: "var(--text-muted)" }}>{c.kind}</span>
      <span style={{ color: bad ? "var(--st-fail)" : "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>{c.status_code ?? (c.failed ? "failed" : "")}</span>
      {c.duration_s != null && <span style={{ color: "var(--text-muted)" }}>{seconds(c.duration_s)}</span>}
      {c.returned != null && c.returned !== "" && <span style={{ color: "var(--text-muted)" }}>{String(c.returned)}</span>}
      <div title={c.request ?? ""} style={{ flexBasis: "100%", fontFamily: "var(--font-mono)", fontSize: 11.5, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {c.request}
      </div>
      {c.outcome && <div style={{ flexBasis: "100%", color: "var(--st-fail)" }}>{c.outcome}</div>}
    </div>
  );
}

/** The exact prompt when saved; otherwise the parents' outputs, each under its parent's name. */
function InputPane({ n, ix, runId, questionId }: { n: LineageNode; ix: ReturnType<typeof indexLineage>; runId: string; questionId: number }) {
  if (n.input?.file) {
    return <FilePane title="Input (exact prompt)" file={n.input.file} runId={runId} questionId={questionId} missing="The input file was not saved." />;
  }
  const from = (n.input?.from?.length ? n.input.from : n.parents).map((id) => ix.node.get(id)).filter((p): p is LineageNode => !!p);
  if (!from.length) return <Pane title="Input"><Faint>No recorded input.</Faint></Pane>;
  return (
    <>
      {from.map((p) => (
        <FilePane
          key={p.id}
          title={`Input from ${nodeName(p, 60)}`}
          file={p.output?.file ?? null}
          runId={runId}
          questionId={questionId}
          missing={p.kind === "input" ? "The question itself." : "That step saved no output."}
        />
      ))}
    </>
  );
}

function FilePane({ title, file, runId, questionId, missing }: { title: string; file: string | null; runId: string; questionId: number; missing: string }) {
  const [text, setText] = useState<string | null | undefined>(file ? undefined : null);
  const [error, setError] = useState<string | null>(null);
  const [all, setAll] = useState(false);

  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    getJson<{ text: string | null }>(`view=step&run=${encodeURIComponent(runId)}&q=${questionId}&file=${encodeURIComponent(file)}`)
      .then(({ text }) => !cancelled && setText(text))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [file, runId, questionId]);

  const long = !!text && text.length > PREVIEW;
  return (
    <Pane
      title={title}
      action={
        long ? (
          <button type="button" onClick={() => setAll(!all)} style={{ ...smallButton, padding: "1px 8px", fontSize: 11.5 }}>
            {all ? "Show first 50k" : `Show all ${chars(text!.length)}`}
          </button>
        ) : null
      }
    >
      {error && <div style={{ color: "var(--st-fail)" }}>{error}</div>}
      {!error && text === undefined && <Faint>Loading…</Faint>}
      {text === null && <Faint>{file ? "This file is not in storage (not uploaded for this run)." : missing}</Faint>}
      {text && (
        <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "var(--font-mono)", fontSize: 11.5, lineHeight: 1.5, maxHeight: 420, overflowY: "auto" }}>
          {all || !long ? text : `${text.slice(0, PREVIEW)}\n\n… ${chars(text.length - PREVIEW)} more chars`}
        </pre>
      )}
      {file && <div style={{ marginTop: 4, fontSize: 10.5, color: "var(--text-faint)" }}>{file}</div>}
    </Pane>
  );
}

function Pane({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: "var(--radius)", marginBottom: 10 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "6px 10px", borderBottom: "1px solid var(--border)", background: "var(--bg-subtle)", fontSize: 12, fontWeight: 600 }}>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</span>
        {action}
      </div>
      <div style={{ padding: "8px 10px" }}>{children}</div>
    </div>
  );
}

function Faint({ children }: { children: ReactNode }) {
  return <div style={{ color: "var(--text-faint)", fontSize: 12.5 }}>{children}</div>;
}
