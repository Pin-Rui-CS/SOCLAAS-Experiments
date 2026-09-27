"use client";

import { useMemo, useState } from "react";
import { TYPE_LABELS, keyOf, typeLabel } from "../api";
import type { LibraryItem } from "../types";
import { valueSummary } from "./Value";
import { Notice } from "./ui";

/** Sentinel for "no competition recorded or found". */
const NONE = "__none__";

const competitionName = (c: { slug: string; name: string | null }) => c.name ?? c.slug;

/** "27 Sep" — unambiguous, unlike 09/27. */
function shortDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

const control = {
  width: "100%",
  padding: "6px 8px",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius)",
  background: "var(--bg)",
  fontSize: 13,
} as const;

export function ForecastList({
  items,
  selected,
  onSelect,
  pendingLookups,
  lookupError,
  error,
}: {
  items: LibraryItem[] | null;
  selected: string | null;
  onSelect: (key: string) => void;
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
        (!needle || i.title.toLowerCase().includes(needle)) &&
        (!type || i.type === type) &&
        (!competition ||
          (competition === NONE
            ? !i.competitions?.length
            : i.competitions?.some((c) => c.slug === competition))) &&
        (!submittedOnly || i.submitted),
    );
  }, [items, search, type, competition, submittedOnly]);

  const filtered = !!(search || type || competition || submittedOnly);

  return (
    <aside className="lib-list">
      <div style={{ padding: "16px 14px 12px", borderBottom: "1px solid var(--border)", display: "grid", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
          <span style={{ fontWeight: 600 }}>Forecast library</span>
          <span style={{ color: "var(--text-muted)", fontSize: 12 }}>
            {!items ? "Loading…" : filtered ? `${visible.length} of ${items.length}` : `${items.length} forecasts`}
          </span>
        </div>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search titles"
          aria-label="Search question titles"
          style={control}
        />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Question type" style={control}>
            <option value="">All types</option>
            {Object.keys(TYPE_LABELS).filter((t) => types.includes(t)).map((t) => (
              <option key={t} value={t}>{typeLabel(t)}</option>
            ))}
          </select>
          <select
            value={competition}
            onChange={(e) => setCompetition(e.target.value)}
            aria-label="Competition"
            style={control}
          >
            <option value="">All competitions</option>
            {competitions.list.map(([slug, name]) => (
              <option key={slug} value={slug}>{name}</option>
            ))}
            {competitions.unknown && pendingLookups === 0 && <option value={NONE}>None / unknown</option>}
          </select>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12.5, color: "var(--text-muted)" }}>
          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input type="checkbox" checked={submittedOnly} onChange={(e) => setSubmittedOnly(e.target.checked)} />
            Submitted only
          </label>
          {pendingLookups > 0 && <span style={{ color: "var(--text-faint)" }}>Looking up competitions… {pendingLookups}</span>}
          {lookupError && (
            <span style={{ color: "var(--text-faint)" }} title={lookupError}>Competition lookup unavailable</span>
          )}
        </div>
      </div>

      {error && <div style={{ padding: "0 12px" }}><Notice tone="warn">{error}</Notice></div>}

      <div style={{ overflowY: "auto", flex: 1 }}>
        {visible.map((item) => {
          const key = keyOf(item);
          const active = key === selected;
          const competitionLabel = item.competitions?.map(competitionName).join(", ");
          return (
            <button
              key={key}
              onClick={() => onSelect(key)}
              aria-current={active ? "true" : undefined}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "11px 14px",
                border: "none",
                borderBottom: "1px solid var(--border)",
                borderLeft: `3px solid ${active ? "var(--accent)" : "transparent"}`,
                background: active ? "var(--bg-active)" : "transparent",
                cursor: "pointer",
              }}
            >
              <div
                style={{
                  fontSize: 13.5,
                  lineHeight: 1.35,
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}
              >
                {item.title}
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 5, fontSize: 12.5 }}>
                <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {valueSummary(item.final, item.unit)}
                </span>
                <span style={{ color: "var(--text-faint)", flexShrink: 0 }}>{shortDate(item.runAt)}</span>
              </div>
              <div style={{ marginTop: 2, fontSize: 12, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {typeLabel(item.type)}
                {competitionLabel ? ` · ${competitionLabel}` : ""}
                {!item.submitted && <span style={{ color: "var(--warn-text)" }}> · not submitted</span>}
              </div>
            </button>
          );
        })}
        {items && !visible.length && (
          <div style={{ padding: 14, color: "var(--text-faint)", fontSize: 13 }}>Nothing matches.</div>
        )}
      </div>
    </aside>
  );
}
