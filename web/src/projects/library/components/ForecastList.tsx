"use client";

import { useMemo, useState } from "react";
import { TYPE_LABELS, keyOf, typeLabel } from "../api";
import type { LibraryItem } from "../types";
import { valueSummary } from "./Value";
import { Notice } from "./ui";
import { DiagnosticsBadge } from "./Diagnostics";

/** Sentinel for "no competition recorded or found". */
const NONE = "__none__";

const competitionName = (c: { slug: string; name: string | null }) => c.name ?? c.slug;

/** "27 Sep" — unambiguous, unlike 09/27. */
function shortDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

const control = {
  width: "100%",
  padding: "5px 8px",
  border: "1px solid var(--border)",
  borderRadius: 6,
  background: "var(--bg)",
  fontSize: 12.5,
} as const;

export function ForecastList({
  items,
  selected,
  onSelect,
  collapsed,
  onToggleCollapse,
  pendingLookups,
  lookupError,
  error,
}: {
  items: LibraryItem[] | null;
  selected: string | null;
  onSelect: (key: string) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  pendingLookups: number;
  lookupError: string | null;
  error: string | null;
}) {
  const [search, setSearch] = useState("");
  const [type, setType] = useState("");
  const [competition, setCompetition] = useState("");
  const [submittedOnly, setSubmittedOnly] = useState(false);

  const competitions = useMemo(() => {
    const seen = new Map<string, string>();
    let unknown = false;
    for (const item of items ?? []) {
      if (!item.competitions?.length) unknown = true;
      for (const c of item.competitions ?? []) seen.set(c.slug, competitionName(c));
    }
    return { list: [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1])), unknown };
  }, [items]);

  const types = useMemo(() => [...new Set((items ?? []).map((i) => i.type))], [items]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (items ?? []).filter(
      (i) =>
        (!needle ||
          i.title.toLowerCase().includes(needle) ||
          String(i.questionId).includes(needle) ||
          (i.postId != null && String(i.postId).includes(needle))) &&
        (!type || i.type === type) &&
        (!competition ||
          (competition === NONE
            ? !i.competitions?.length
            : i.competitions?.some((c) => c.slug === competition))) &&
        (!submittedOnly || i.submitted),
    );
  }, [items, search, type, competition, submittedOnly]);

  const filtered = !!(search || type || competition || submittedOnly);

  if (collapsed) {
    return (
      <aside className="lib-list lib-list-collapsed" aria-label="Forecast list (collapsed)">
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-label="Expand forecast list"
          title="Expand forecast list"
          style={railBtn}
        >
          »
        </button>
        <div
          style={{
            writingMode: "vertical-rl",
            transform: "rotate(180deg)",
            fontSize: 11.5,
            fontWeight: 600,
            letterSpacing: "0.04em",
            color: "var(--text-muted)",
            marginTop: 12,
            userSelect: "none",
          }}
        >
          Forecasts {items ? `(${items.length})` : ""}
        </div>
      </aside>
    );
  }

  return (
    <aside className="lib-list">
      <div style={{ padding: "12px 12px 10px", borderBottom: "1px solid var(--border)", display: "grid", gap: 7 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
          <span style={{ fontWeight: 600, fontSize: 13 }}>Forecasts</span>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ color: "var(--text-faint)", fontSize: 11.5, fontVariantNumeric: "tabular-nums" }}>
              {!items ? "…" : filtered ? `${visible.length}/${items.length}` : `${items.length}`}
            </span>
            <button
              type="button"
              onClick={onToggleCollapse}
              aria-label="Collapse forecast list"
              title="Collapse forecast list"
              className="lib-collapse-btn"
              style={{ ...railBtn, width: 24, height: 24, fontSize: 13 }}
            >
              «
            </button>
          </span>
        </div>

        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search title, Q ID, or post ID…"
          aria-label="Search forecasts"
          style={control}
        />

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Question type" style={control}>
            <option value="">All types</option>
            {Object.keys(TYPE_LABELS)
              .filter((t) => types.includes(t))
              .map((t) => (
                <option key={t} value={t}>
                  {typeLabel(t)}
                </option>
              ))}
          </select>
          <select
            value={competition}
            onChange={(e) => setCompetition(e.target.value)}
            aria-label="Competition"
            style={control}
          >
            <option value="">All cups</option>
            {competitions.list.map(([slug, name]) => (
              <option key={slug} value={slug}>
                {name}
              </option>
            ))}
            {competitions.unknown && pendingLookups === 0 && <option value={NONE}>None / unknown</option>}
          </select>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11.5, color: "var(--text-muted)" }}>
          <label style={{ display: "flex", gap: 5, alignItems: "center", cursor: "pointer" }}>
            <input type="checkbox" checked={submittedOnly} onChange={(e) => setSubmittedOnly(e.target.checked)} />
            Submitted only
          </label>
          {pendingLookups > 0 && <span style={{ color: "var(--text-faint)" }}>Syncing… {pendingLookups}</span>}
          {lookupError && (
            <span style={{ color: "var(--text-faint)" }} title={lookupError}>
              Cup sync offline
            </span>
          )}
        </div>
      </div>

      {error && (
        <div style={{ padding: "0 10px" }}>
          <Notice tone="warn">{error}</Notice>
        </div>
      )}

      <div style={{ overflowY: "auto", flex: 1 }}>
        {visible.map((item) => {
          const key = keyOf(item);
          const active = key === selected;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onSelect(key)}
              aria-current={active ? "true" : undefined}
              className="lib-row"
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "9px 12px",
                border: "none",
                borderBottom: "1px solid var(--border)",
                borderLeft: `2px solid ${active ? "var(--accent)" : "transparent"}`,
                background: active ? "var(--bg-active)" : "transparent",
                cursor: "pointer",
              }}
            >
              <div
                style={{
                  fontSize: 13,
                  lineHeight: 1.35,
                  fontWeight: active ? 560 : 440,
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}
              >
                {item.title}
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, marginTop: 4, fontSize: 12 }}>
                <span
                  style={{
                    fontWeight: 600,
                    fontVariantNumeric: "tabular-nums",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {valueSummary(item.final, item.unit)}
                </span>
                <span style={{ color: "var(--text-faint)", fontSize: 11.5, flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>
                  {shortDate(item.runAt)}
                </span>
              </div>
              <div
                style={{
                  marginTop: 2,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 11,
                  color: "var(--text-faint)",
                  overflow: "hidden",
                  whiteSpace: "nowrap",
                }}
              >
                <span>{typeLabel(item.type)}</span>
                {item.postId && <span style={{ fontFamily: "var(--font-mono)" }}>#{item.postId}</span>}
                {!item.submitted && <span style={{ color: "var(--warn-text)" }}>dry</span>}
                {item.diagnostics && (
                  <span style={{ marginLeft: "auto" }}>
                    <DiagnosticsBadge summary={item.diagnostics} />
                  </span>
                )}
              </div>
            </button>
          );
        })}
        {items && !visible.length && (
          <div style={{ padding: 14, color: "var(--text-faint)", fontSize: 12.5 }}>No matching forecasts.</div>
        )}
      </div>
    </aside>
  );
}

const railBtn = {
  width: 28,
  height: 28,
  display: "grid",
  placeItems: "center",
  border: "1px solid var(--border)",
  borderRadius: 6,
  background: "var(--bg-raised)",
  color: "var(--text-muted)",
  cursor: "pointer",
  fontSize: 14,
  lineHeight: 1,
} as const;
