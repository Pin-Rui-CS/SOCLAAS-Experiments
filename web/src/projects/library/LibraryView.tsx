"use client";

import { useEffect, useState } from "react";
import { getJson, keyOf, typeLabel } from "./api";
import { useCompetitions } from "./useCompetitions";
import { ForecastList } from "./components/ForecastList";
import { Glance } from "./components/Glance";
import { DetailTabs, TABS, type TabKey } from "./components/DetailTabs";
import { vizPaletteCss } from "./components/DistributionCharts";
import { formatDate } from "./components/Value";
import { Notice } from "./components/ui";
import type { ForecastDetail, LibraryItem } from "./types";

const TAB_STORAGE_KEY = "soclaas.library.tab";

function initialTab(): TabKey {
  try {
    const saved = localStorage.getItem(TAB_STORAGE_KEY);
    if (TABS.some((t) => t.key === saved)) return saved as TabKey;
  } catch {
    // no storage — default below
  }
  return "models";
}

export default function LibraryView() {
  const [rawItems, setRawItems] = useState<LibraryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  // The open tab carries over from one forecast to the next, and across visits.
  const [tab, setTab] = useState<TabKey>(initialTab);

  const { items, pending, failed } = useCompetitions(rawItems);

  useEffect(() => {
    getJson<{ items: LibraryItem[] }>("view=list")
      .then(({ items }) => {
        setRawItems(items);
        if (items.length) setSelected((current) => current ?? keyOf(items[0]));
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  const chooseTab = (next: TabKey) => {
    setTab(next);
    try {
      localStorage.setItem(TAB_STORAGE_KEY, next);
    } catch {
      // per-browser convenience only
    }
  };

  const current = items?.find((i) => keyOf(i) === selected) ?? null;

  return (
    <div className="lib">
      <ForecastList
        items={items}
        selected={selected}
        onSelect={setSelected}
        pendingLookups={pending}
        lookupError={failed}
        error={error}
      />

      <main className="lib-detail">
        {current ? (
          <Detail key={keyOf(current)} item={current} tab={tab} onTab={chooseTab} />
        ) : (
          !error && <div style={{ padding: 32, color: "var(--text-faint)" }}>{items ? "Select a forecast." : "Loading…"}</div>
        )}
      </main>

      <style>{`
        ${vizPaletteCss(".lib")}
        .lib { display: flex; height: 100%; min-height: 0; }
        .lib-list { width: 320px; flex-shrink: 0; display: flex; flex-direction: column; border-right: 1px solid var(--border); background: var(--bg-subtle); min-height: 0; }
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

function Detail({ item, tab, onTab }: { item: LibraryItem; tab: TabKey; onTab: (tab: TabKey) => void }) {
  const [detail, setDetail] = useState<ForecastDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getJson<ForecastDetail>(`view=forecast&run=${encodeURIComponent(item.runId)}&q=${item.questionId}`)
      .then(setDetail)
      .catch((e: Error) => setError(e.message));
  }, [item.runId, item.questionId]);

  const unit = detail?.question.unit ?? item.unit;
  const competition = item.competitions?.map((c) => c.name ?? c.slug).join(", ");
  const link = { color: "var(--accent)" } as const;

  return (
    <div style={{ maxWidth: 1040, margin: "0 auto", padding: "26px 28px 64px" }}>
      <h1 style={{ fontSize: 21, fontWeight: 600, letterSpacing: "-0.01em", margin: 0, lineHeight: 1.3 }}>{item.title}</h1>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 8px", marginTop: 8, fontSize: 12.5, color: "var(--text-muted)" }}>
        {[
          typeLabel(item.type),
          competition,
          `Forecast ${formatDate(item.runAt)}`,
          item.abstained ? "abstained" : item.submitted ? "submitted" : null,
        ]
          .filter(Boolean)
          .map((part, i) => (
            <span key={i}>{i > 0 && <span style={{ color: "var(--text-faint)", marginRight: 8 }}>·</span>}{part}</span>
          ))}
        {!item.submitted && !item.abstained && (
          <span style={{ color: "var(--warn-text)" }}><span style={{ color: "var(--text-faint)", marginRight: 8 }}>·</span>not submitted</span>
        )}
        <span style={{ marginLeft: "auto", display: "flex", gap: 14 }}>
          {item.postId && (
            <a href={`https://www.metaculus.com/questions/${item.postId}/`} target="_blank" rel="noopener noreferrer" style={link}>
              Metaculus ↗
            </a>
          )}
          {detail?.runUrl && (
            <a href={detail.runUrl} target="_blank" rel="noopener noreferrer" style={link}>
              GitHub run ↗
            </a>
          )}
        </span>
      </div>

      {error && <Notice tone="warn">{error}</Notice>}
      {!detail && !error && <div style={{ marginTop: 24, color: "var(--text-faint)" }}>Loading…</div>}

      {detail && (
        <>
          <Glance detail={detail} unit={unit} />
          <DetailTabs detail={detail} unit={unit} tab={tab} onTab={onTab} />
        </>
      )}
    </div>
  );
}
