"use client";

import { useMemo, useState } from "react";
import type { LineageCall } from "../../types";
import { Chip, indexLineage, nodeName, seconds, smallButton } from "./shared";

/**
 * Every external call (LINEAGE.md §6.2), in the order they started. A 200 can
 * still be a failure, so `outcome` sits beside the status code. "Next" follows
 * the pipeline: a retry if this call was retried, otherwise the first call of
 * each step this one fed — or that step's page when it made no call.
 */

const problem = (c: LineageCall) => c.failed || (c.status_code ?? 0) >= 400 || !!c.outcome?.trim();

export function CallsTable({
  ix,
  onOpen,
}: {
  ix: ReturnType<typeof indexLineage>;
  onOpen: (nodeId: string) => void;
}) {
  const { doc } = ix;
  const [kinds, setKinds] = useState<Set<string>>(() => new Set());
  const [problemsOnly, setProblemsOnly] = useState(false);

  const rows = useMemo(
    () =>
      doc.calls
        .map((c, i) => ({ c, i }))
        .sort((a, b) => {
          const ta = a.c.started_at ? Date.parse(a.c.started_at) : Infinity;
          const tb = b.c.started_at ? Date.parse(b.c.started_at) : Infinity;
          return ta - tb || a.i - b.i;
        })
        .map(({ c }) => c),
    [doc.calls],
  );

  // The timeline: each call against the whole run (run start = the earliest timestamp we have).
  const { start, total } = useMemo(() => {
    const times = [...doc.calls.map((c) => c.started_at), ...doc.nodes.map((n) => n.ts)]
      .filter((t): t is string => !!t)
      .map((t) => Date.parse(t))
      .filter(Number.isFinite);
    const start = times.length ? Math.min(...times) : null;
    const total = doc.run.timings?.total_seconds ?? null;
    return { start, total };
  }, [doc]);

  const allKinds = useMemo(() => [...new Set(doc.calls.map((c) => c.kind))], [doc.calls]);
  const visible = rows.filter((c) => (!kinds.size || kinds.has(c.kind)) && (!problemsOnly || problem(c)));
  const problems = doc.calls.filter(problem).length;

  const next = (c: LineageCall) => {
    const retry = ix.retryOf.get(c.id);
    if (retry) return [{ key: retry.id, label: "↻ retry", node: retry.node_id, call: retry }];
    const step = c.node_id ? ix.node.get(c.node_id) : undefined;
    return (step?.children ?? []).map((childId) => {
      const first = ix.callsByNode.get(childId)?.[0];
      return { key: childId, label: nodeName(ix.node.get(childId), 22), node: childId, call: first };
    });
  };

  const toggleKind = (k: string) =>
    setKinds((current) => {
      const s = new Set(current);
      if (s.has(k)) s.delete(k);
      else s.add(k);
      return s;
    });

  const cell = { padding: "6px 8px", borderBottom: "1px solid var(--border)", verticalAlign: "top" } as const;

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, marginBottom: 10, fontSize: 12.5 }}>
        <span style={{ color: "var(--text-muted)" }}>Kind:</span>
        {allKinds.map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={kinds.has(k)}
            onClick={() => toggleKind(k)}
            style={{ ...smallButton, padding: "1px 9px", background: kinds.has(k) ? "var(--bg-active)" : "transparent" }}
          >
            {k} <span style={{ color: "var(--text-faint)" }}>{doc.calls.filter((c) => c.kind === k).length}</span>
          </button>
        ))}
        <label style={{ display: "flex", alignItems: "center", gap: 5, marginLeft: 10, color: problems ? "var(--st-fail)" : "var(--text-muted)" }}>
          <input type="checkbox" checked={problemsOnly} onChange={(e) => setProblemsOnly(e.target.checked)} />
          Problems only ({problems})
        </label>
        <span style={{ marginLeft: "auto", color: "var(--text-faint)" }}>
          {visible.length} of {doc.calls.length} calls
        </span>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", fontSize: 12.5, width: "100%", minWidth: 900 }}>
          <thead>
            <tr style={{ color: "var(--text-muted)", textAlign: "left" }}>
              {["Service", "Kind", "Request", "Status", "Time", "Returned", "Next →", ""].map((h) => (
                <th key={h} style={{ ...cell, fontWeight: 600, whiteSpace: "nowrap" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((c) => {
              const bad = problem(c);
              const offset = start != null && c.started_at ? (Date.parse(c.started_at) - start) / 1000 : null;
              return (
                <tr key={c.id} style={{ background: bad ? "var(--st-fail-bg)" : undefined }}>
                  <td style={{ ...cell, whiteSpace: "nowrap" }}>{c.service ?? "—"}</td>
                  <td style={{ ...cell, color: "var(--text-muted)" }}>{c.kind}</td>
                  <td style={{ ...cell, maxWidth: 320 }}>
                    <div title={c.request ?? ""} style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {c.request ?? "—"}
                    </div>
                  </td>
                  <td style={{ ...cell, maxWidth: 220 }}>
                    <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600, color: bad ? "var(--st-fail)" : "var(--text)" }}>
                      {c.status_code ?? (c.failed ? "failed" : "—")}
                    </span>
                    {c.outcome && <div style={{ color: "var(--st-fail)", fontSize: 11.5, lineHeight: 1.35 }}>{c.outcome}</div>}
                  </td>
                  <td style={{ ...cell, whiteSpace: "nowrap" }}>
                    <div style={{ fontVariantNumeric: "tabular-nums" }}>{seconds(c.duration_s)}</div>
                    <Timeline offset={offset} duration={c.duration_s ?? null} total={total} />
                  </td>
                  <td style={{ ...cell, color: "var(--text-muted)", whiteSpace: "nowrap" }}>{c.returned === "" || c.returned == null ? "—" : String(c.returned)}</td>
                  <td style={cell}>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                      {next(c).map((n) => (
                        <Chip
                          key={n.key}
                          onClick={() => n.node && onOpen(n.node)}
                          title={n.call ? `${n.call.service ?? ""} ${n.call.request ?? ""}` : "No external call — opens the step"}
                        >
                          {n.label}
                        </Chip>
                      ))}
                    </div>
                  </td>
                  <td style={{ ...cell, whiteSpace: "nowrap" }}>
                    {c.node_id ? (
                      <button type="button" onClick={() => onOpen(c.node_id!)} style={{ border: "none", background: "none", color: "var(--accent)", cursor: "pointer", fontSize: 12.5, padding: 0 }}>
                        Open ↗
                      </button>
                    ) : (
                      <span style={{ color: "var(--text-faint)" }} title="This call was not tied to a step">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Where the call sat in the run: a bar against the run's total time. */
function Timeline({ offset, duration, total }: { offset: number | null; duration: number | null; total: number | null }) {
  if (offset == null || !total) return null;
  const left = Math.max(0, Math.min(1, offset / total));
  const width = duration ? Math.max(0.004, Math.min(1 - left, duration / total)) : 0.004;
  return (
    <div style={{ position: "relative", width: 90, height: 5, borderRadius: 3, background: "var(--bg-hover)", marginTop: 3 }} title={`${seconds(offset)} into the run`}>
      <div style={{ position: "absolute", left: `${left * 100}%`, width: `${width * 100}%`, minWidth: 2, top: 0, bottom: 0, borderRadius: 3, background: "var(--st-info)" }} />
    </div>
  );
}
