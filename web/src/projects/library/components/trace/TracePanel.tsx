"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getJson } from "../../api";
import type { LineageRecord } from "../../types";
import { formatDate } from "../Value";
import { CallsTable } from "./CallsTable";
import { Evidence } from "./Evidence";
import { FlowMap } from "./FlowMap";
import { StepSheet } from "./StepSheet";
import { indexLineage, seconds } from "./shared";

/**
 * The Run trace tab (bot repo diagnostics/LINEAGE.md): a flow map, the API
 * calls and the evidence lifecycle of one diagnosed forecast, all from its
 * run_lineage document. Any step opens a sheet with its input and output; the
 * open step lives in the URL hash (#step-n17), as the spec suggests.
 */

type View = "map" | "calls" | "evidence";
const VIEWS: { key: View; label: string }[] = [
  { key: "map", label: "Flow map" },
  { key: "calls", label: "API calls" },
  { key: "evidence", label: "Evidence" },
];
const VIEW_KEY = "soclaas.library.traceView";

function initialView(): View {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    if (VIEWS.some((x) => x.key === v)) return v as View;
  } catch {
    // default below
  }
  return "map";
}

function stepFromHash(): string | null {
  if (typeof window === "undefined") return null;
  const m = /^#step-(.+)$/.exec(window.location.hash);
  return m ? decodeURIComponent(m[1]) : null;
}

export function TracePanel({ runId, questionId }: { runId: string; questionId: number }) {
  const [record, setRecord] = useState<LineageRecord | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>(initialView);
  const [step, setStep] = useState<string | null>(stepFromHash);

  useEffect(() => {
    getJson<{ record: LineageRecord | null }>(`view=lineage&run=${encodeURIComponent(runId)}&q=${questionId}`)
      .then(({ record }) => setRecord(record))
      .catch((e: Error) => setError(e.message));
  }, [runId, questionId]);

  const ix = useMemo(() => (record ? indexLineage(record.lineage) : null), [record]);

  const open = useCallback((id: string) => {
    setStep(id);
    try {
      history.replaceState(null, "", `#step-${encodeURIComponent(id)}`);
    } catch {
      // the sheet still opens; only the shareable hash is lost
    }
  }, []);

  const close = useCallback(() => {
    setStep(null);
    try {
      history.replaceState(null, "", window.location.pathname + window.location.search);
    } catch {
      // nothing to undo
    }
  }, []);

  const chooseView = (v: View) => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      // per-browser convenience only
    }
  };

  if (error) return <div style={{ marginTop: 16, color: "var(--st-fail)", fontSize: 13 }}>{error}</div>;
  if (record === undefined) return <div style={{ marginTop: 16, color: "var(--text-faint)", fontSize: 13 }}>Loading the run trace…</div>;
  if (!record || !ix) return <div style={{ marginTop: 16, color: "var(--text-faint)", fontSize: 13 }}>No run trace for this forecast.</div>;

  const doc = record.lineage;
  const inferred = record.source !== "declared";
  const t = doc.run.timings ?? {};

  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px 14px", marginBottom: 12 }}>
        <div role="tablist" aria-label="Run trace views" style={{ display: "inline-flex", border: "1px solid var(--border)", borderRadius: "var(--radius)", overflow: "hidden" }}>
          {VIEWS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={view === key}
              onClick={() => chooseView(key)}
              style={{
                padding: "5px 14px",
                border: "none",
                borderLeft: key === "map" ? "none" : "1px solid var(--border)",
                background: view === key ? "var(--bg-active)" : "transparent",
                fontWeight: view === key ? 600 : 450,
                fontSize: 12.5,
                cursor: "pointer",
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
          {doc.nodes.length} steps · {doc.calls.length} calls · {doc.facts.length} facts
          {t.total_seconds != null ? ` · ${seconds(t.total_seconds)}` : ""}
        </span>
        {inferred && (
          <span
            title="This run predates the bot recording what each step read: links were reconstructed from a fixed per-stage table. Some timings, status codes and forecast outputs are missing."
            style={{ fontSize: 11.5, padding: "1px 8px", borderRadius: 10, border: "1px dashed var(--border-strong)", color: "var(--text-muted)" }}
          >
            links inferred
          </span>
        )}
        <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--text-faint)" }}>Diagnosed {formatDate(record.diagnosedAt)}</span>
      </div>

      {view === "map" && (
        <>
          <div style={{ fontSize: 12, color: "var(--text-faint)", marginBottom: 10 }}>
            Read top to bottom. Arrows show what fed what, labelled with the characters passed on; red dashed arrows lost text to a cut. Click a step to open it.
          </div>
          <FlowMap ix={ix} selected={step} onSelect={open} />
        </>
      )}
      {view === "calls" && <CallsTable ix={ix} onOpen={open} />}
      {view === "evidence" && <Evidence ix={ix} onOpen={open} />}

      {step && ix.node.has(step) && (
        <StepSheet key={step} ix={ix} nodeId={step} runId={runId} questionId={questionId} onSelect={open} onClose={close} />
      )}
    </div>
  );
}
