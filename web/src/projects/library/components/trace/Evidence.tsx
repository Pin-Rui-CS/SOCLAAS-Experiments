"use client";

import { useMemo, useState } from "react";
import type { LineageFact } from "../../types";
import { Chip, FACT_LABELS, FACT_STATES, factFill, factStyle, indexLineage, nodeName, shortLabel, smallButton } from "./shared";

/**
 * Evidence lifecycle (LINEAGE.md §6.4): each fact the pipeline handled, and the
 * chain of steps it passed through — kept, modified, dropped by choice, or lost
 * to a cut. The losses chart answers "which step loses the most".
 */

const PAGE = 60;

export function Evidence({
  ix,
  onOpen,
}: {
  ix: ReturnType<typeof indexLineage>;
  onOpen: (nodeId: string) => void;
}) {
  const { doc } = ix;
  const [finalState, setFinalState] = useState("");
  const [lostOnly, setLostOnly] = useState(false);
  const [planOnly, setPlanOnly] = useState(false);
  const [limit, setLimit] = useState(PAGE);

  const visible = useMemo(
    () =>
      doc.facts.filter(
        (f) => (!finalState || f.final_state === finalState) && (!lostOnly || f.lost_at) && (!planOnly || f.plan_item),
      ),
    [doc.facts, finalState, lostOnly, planOnly],
  );
  const plan = visible.filter((f) => f.plan_item);
  const rest = visible.filter((f) => !f.plan_item);
  const states = useMemo(() => [...new Set(doc.facts.map((f) => f.final_state))], [doc.facts]);

  return (
    <div>
      <Losses losses={doc.losses} />

      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, margin: "18px 0 10px", fontSize: 12.5 }}>
        <select
          value={finalState}
          onChange={(e) => {
            setFinalState(e.target.value);
            setLimit(PAGE);
          }}
          aria-label="Final state"
          style={{ padding: "4px 6px", border: "1px solid var(--border)", borderRadius: "var(--radius)", background: "var(--bg)", fontSize: 12.5 }}
        >
          <option value="">Any final state</option>
          {states.map((s) => (
            <option key={s} value={s}>
              {FACT_LABELS[s] ?? s} ({doc.facts.filter((f) => f.final_state === s).length})
            </option>
          ))}
        </select>
        <label style={{ display: "flex", alignItems: "center", gap: 5, color: "var(--text-muted)" }}>
          <input type="checkbox" checked={lostOnly} onChange={(e) => setLostOnly(e.target.checked)} /> Lost only
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 5, color: "var(--text-muted)" }}>
          <input type="checkbox" checked={planOnly} onChange={(e) => setPlanOnly(e.target.checked)} /> Plan items only
        </label>
        <span style={{ marginLeft: "auto", color: "var(--text-faint)" }}>
          {visible.length} of {doc.facts.length} facts
        </span>
      </div>

      {plan.length > 0 && (
        <>
          <h4 style={headingStyle}>Plan items — what the evidence plan asked for</h4>
          <FactList facts={plan} ix={ix} onOpen={onOpen} />
        </>
      )}
      {rest.length > 0 && (
        <>
          {plan.length > 0 && <h4 style={headingStyle}>Facts found along the way</h4>}
          <FactList facts={rest.slice(0, limit)} ix={ix} onOpen={onOpen} />
          {rest.length > limit && (
            <button type="button" onClick={() => setLimit(limit + PAGE)} style={{ ...smallButton, marginTop: 8 }}>
              Show {Math.min(PAGE, rest.length - limit)} more ({rest.length - limit} left)
            </button>
          )}
        </>
      )}
      {!visible.length && <div style={{ color: "var(--text-faint)", fontSize: 13 }}>No facts match.</div>}
    </div>
  );
}

const headingStyle = { fontSize: 13, fontWeight: 600, margin: "14px 0 6px" } as const;

function FactList({ facts, ix, onOpen }: { facts: LineageFact[]; ix: ReturnType<typeof indexLineage>; onOpen: (id: string) => void }) {
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: "var(--radius)" }}>
      {facts.map((f, i) => (
        <div key={f.id} style={{ padding: "8px 12px", borderTop: i ? "1px solid var(--border)" : "none" }}>
          <div style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
            <span
              title={f.claim}
              style={{ flex: 1, minWidth: 0, fontSize: 13, lineHeight: 1.45, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}
            >
              {f.claim}
            </span>
            <Chip style={{ ...factStyle(f.final_state), fontWeight: 600, flexShrink: 0 }}>{FACT_LABELS[f.final_state] ?? f.final_state}</Chip>
          </div>
          {f.source && (
            <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 2 }} title={f.source}>
              {shortLabel(f.source, 70)}
            </div>
          )}
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 4, marginTop: 6 }}>
            {f.steps.map((s, j) => {
              const node = s.node_id ? ix.node.get(s.node_id) : undefined;
              return (
                <span key={j} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  {j > 0 && <span aria-hidden style={{ color: "var(--text-faint)", fontSize: 11 }}>→</span>}
                  <Chip
                    onClick={s.node_id ? () => onOpen(s.node_id!) : undefined}
                    style={factStyle(s.state)}
                    title={[`${FACT_LABELS[s.state] ?? s.state} at ${nodeName(node, 80)}`, s.note, s.quote ? `“${s.quote}”` : ""].filter(Boolean).join("\n")}
                  >
                    {nodeName(node, 24)}
                  </Chip>
                </span>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

/** One bar per stage, stacked by how the facts were lost or changed there. */
function Losses({ losses }: { losses: Record<string, Record<string, number>> }) {
  const rows = Object.entries(losses)
    .map(([stage, byState]) => ({ stage, byState, total: Object.values(byState).reduce((a, b) => a + b, 0) }))
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total);
  if (!rows.length) return <div style={{ fontSize: 13, color: "var(--text-faint)" }}>No facts were lost or changed.</div>;
  const max = Math.max(...rows.map((r) => r.total));
  const used = FACT_STATES.filter((s) => rows.some((r) => r.byState[s]));
  const others = [...new Set(rows.flatMap((r) => Object.keys(r.byState)))].filter((s) => !(FACT_STATES as readonly string[]).includes(s));

  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>Where facts were lost or changed</div>
      <div style={{ fontSize: 12, color: "var(--text-faint)", marginBottom: 8 }}>By stage. Dropped = a step left it out by choice; gone = lost to a cut or failure.</div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(90px, 160px) 1fr 40px", gap: "6px 10px", alignItems: "center", maxWidth: 640 }}>
        {rows.map((r) => (
          <div key={r.stage} style={{ display: "contents" }}>
            <span style={{ fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.stage}>{r.stage}</span>
            <div style={{ display: "flex", height: 12, width: `${(r.total / max) * 100}%`, minWidth: 4, gap: 2 }}>
              {[...used, ...others].filter((s) => r.byState[s]).map((s) => (
                <span
                  key={s}
                  title={`${FACT_LABELS[s] ?? s}: ${r.byState[s]}`}
                  style={{ flex: r.byState[s], background: factFill(s), borderRadius: 2, opacity: s === "gone" ? 0.6 : 1 }}
                />
              ))}
            </div>
            <span style={{ fontSize: 12, color: "var(--text-muted)", fontVariantNumeric: "tabular-nums", textAlign: "right" }}>{r.total}</span>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 8, fontSize: 11.5, color: "var(--text-muted)" }}>
        {[...used, ...others].map((s) => (
          <span key={s} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span aria-hidden style={{ width: 10, height: 10, borderRadius: 2, background: factFill(s), opacity: s === "gone" ? 0.6 : 1 }} />
            {FACT_LABELS[s] ?? s}
          </span>
        ))}
      </div>
    </div>
  );
}
