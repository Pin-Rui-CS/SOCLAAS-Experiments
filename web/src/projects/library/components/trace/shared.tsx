"use client";

import type { CSSProperties, ReactNode } from "react";
import type { LineageCall, LineageDoc, LineageNode } from "../../types";

/**
 * Helpers shared by the run-trace views (LINEAGE.md §6). Nothing here knows a
 * stage, lane or kind by name — the document says what exists, and unknown
 * values render as plain text.
 */

export type LineageIndex = {
  doc: LineageDoc;
  node: Map<string, LineageNode>;
  callsByNode: Map<string, LineageCall[]>;
  call: Map<string, LineageCall>;
  /** The call that retried each call, keyed by the original's id. */
  retryOf: Map<string, LineageCall>;
};

export function indexLineage(doc: LineageDoc): LineageIndex {
  const node = new Map(doc.nodes.map((n) => [n.id, n]));
  const call = new Map(doc.calls.map((c) => [c.id, c]));
  const callsByNode = new Map<string, LineageCall[]>();
  const retryOf = new Map<string, LineageCall>();
  for (const c of doc.calls) {
    if (c.node_id) callsByNode.set(c.node_id, [...(callsByNode.get(c.node_id) ?? []), c]);
    if (c.retry_of) retryOf.set(c.retry_of, c);
  }
  return { doc, node, callsByNode, call, retryOf };
}

/** A URL becomes host + the end of its path; anything else is clipped. */
export function shortLabel(label: string | null | undefined, max = 42): string {
  const text = (label ?? "").trim();
  if (!text) return "—";
  if (/^https?:\/\//i.test(text)) {
    try {
      const u = new URL(text);
      const tail = u.pathname.split("/").filter(Boolean).pop() ?? "";
      const host = u.hostname.replace(/^www\./, "");
      const s = tail ? `${host} › ${decodeURIComponent(tail)}` : host;
      return s.length > max ? `${s.slice(0, max - 1)}…` : s;
    } catch {
      // not a parseable URL after all
    }
  }
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function nodeName(n: LineageNode | undefined, max = 42): string {
  if (!n) return "unknown step";
  const label = shortLabel(n.label, max);
  return label === "—" || label === n.stage ? n.stage : `${n.stage} · ${label}`;
}

/** 32500 → "32.5k". */
export function chars(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1).replace(/\.0$/, "")}k`;
  return String(n);
}

export function seconds(s: number | null | undefined): string {
  if (s == null || !Number.isFinite(s)) return "—";
  if (s < 1) return `${Math.round(s * 1000)}ms`;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

/* --- node status (§3): the Diagnostics palette, --st-* from statusCss ---------------- */

const NODE_STATUS: Record<string, string> = { pass: "pass", warn: "warn", fail: "fail", unused: "skipped" };
const RANK: Record<string, number> = { fail: 3, warn: 2, pass: 1, unused: 0 };

export const statusVar = (status: string) => `var(--st-${NODE_STATUS[status] ?? "info"})`;

export function worstStatus(nodes: LineageNode[]): string {
  return nodes.reduce((w, n) => ((RANK[n.status] ?? 1) > (RANK[w] ?? 1) ? n.status : w), "unused");
}

export function StatusDot({ status, size = 8 }: { status: string; size?: number }) {
  const unused = status === "unused";
  return (
    <span
      aria-hidden
      title={status}
      style={{
        display: "inline-block",
        width: size,
        height: size,
        borderRadius: "50%",
        flexShrink: 0,
        background: unused ? "transparent" : statusVar(status),
        border: unused ? `1.5px dashed ${statusVar(status)}` : "none",
        boxSizing: "border-box",
      }}
    />
  );
}

export function StatusPill({ status }: { status: string }) {
  const s = NODE_STATUS[status] ?? "info";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "0 8px",
        borderRadius: 10,
        fontSize: 11.5,
        lineHeight: "19px",
        fontWeight: 600,
        color: `var(--st-${s})`,
        background: `var(--st-${s}-bg)`,
        border: status === "unused" ? `1px dashed var(--st-${s})` : "1px solid transparent",
        whiteSpace: "nowrap",
      }}
    >
      <StatusDot status={status} size={7} />
      {status}
    </span>
  );
}

/* --- fact states (§6.4) --------------------------------------------------------------- */

export const FACT_STATES = ["present", "modified", "dropped", "gone", "never_fetched", "unknown"] as const;

export const FACT_LABELS: Record<string, string> = {
  present: "present",
  modified: "modified",
  dropped: "dropped",
  gone: "gone",
  never_fetched: "never fetched",
  unknown: "unknown",
};

export function factStyle(state: string): CSSProperties {
  switch (state) {
    case "present":
      return { color: "var(--st-pass)", background: "var(--st-pass-bg)", border: "1px solid transparent" };
    case "modified":
      return { color: "var(--st-warn)", background: "var(--st-warn-bg)", border: "1px solid transparent" };
    case "dropped":
      return { color: "var(--st-fail)", background: "var(--st-fail-bg)", border: "1px solid transparent" };
    case "gone":
      return { color: "var(--st-skipped)", background: "var(--st-skipped-bg)", border: "1px solid transparent", textDecoration: "line-through" };
    case "never_fetched":
      return { color: "var(--st-fail)", background: "transparent", border: "1.5px dashed var(--st-fail)" };
    default:
      return { color: "var(--text-faint)", background: "transparent", border: "1px solid var(--border)" };
  }
}

/** Fill colour for a fact state in the losses chart. */
export function factFill(state: string): string {
  switch (state) {
    case "present": return "var(--st-pass)";
    case "modified": return "var(--st-warn)";
    case "dropped": return "var(--st-fail)";
    case "gone": return "var(--st-skipped)";
    case "never_fetched": return "var(--st-fail)";
    default: return "var(--border-strong)";
  }
}

export function Chip({
  children,
  onClick,
  style,
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  style?: CSSProperties;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        maxWidth: 260,
        padding: "1px 8px",
        borderRadius: 10,
        fontSize: 11.5,
        lineHeight: "18px",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        cursor: onClick ? "pointer" : "default",
        border: "1px solid var(--border)",
        background: "var(--bg-subtle)",
        color: "var(--text)",
        ...style,
      }}
    >
      {children}
    </button>
  );
}

export const smallButton: CSSProperties = {
  padding: "3px 10px",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius)",
  background: "transparent",
  cursor: "pointer",
  fontSize: 12.5,
};
