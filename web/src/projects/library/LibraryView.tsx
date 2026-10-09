"use client";

import { useEffect, useState } from "react";
import { getJson, keyOf, typeLabel } from "./api";
import { useCompetitions } from "./useCompetitions";
import { ForecastList } from "./components/ForecastList";
import { Glance } from "./components/Glance";
import { ALL_TABS, DetailTabs, type TabKey } from "./components/DetailTabs";
import { statusCss } from "./components/Diagnostics";
import { vizPaletteCss } from "./components/DistributionCharts";
import { formatDate } from "./components/Value";
import { Notice } from "./components/ui";
import { ChatPanel } from "./components/ChatPanel";
import { DownloadMenu } from "./components/DownloadMenu";
import type { ForecastDetail, LibraryItem } from "./types";

const TAB_STORAGE_KEY = "soclaas.library.tab";
const CHAT_OPEN_KEY = "soclaas.library.chatOpen";

function initialTab(): TabKey {
  try {
    const saved = localStorage.getItem(TAB_STORAGE_KEY);
    if (ALL_TABS.some((t) => t.key === saved)) return saved as TabKey;
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
  // Only read once a forecast is on screen, so server and client render the same first frame.
  const [chatOpen, setChatOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem(CHAT_OPEN_KEY) === "1";
    } catch {
      return false;
    }
  });

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

  const toggleChat = (open: boolean) => {
    setChatOpen(open);
    try {
      localStorage.setItem(CHAT_OPEN_KEY, open ? "1" : "0");
    } catch {
      // per-browser convenience only
    }
  };

  // Escape closes the discussion where it overlays the page.
  useEffect(() => {
    if (!chatOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && window.matchMedia("(max-width: 1199px)").matches) toggleChat(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [chatOpen]);

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
          <Detail key={keyOf(current)} item={current} tab={tab} onTab={chooseTab} chatOpen={chatOpen} onToggleChat={() => toggleChat(!chatOpen)} />
        ) : (
          !error && <div style={{ padding: 32, color: "var(--text-faint)" }}>{items ? "Select a forecast." : "Loading…"}</div>
        )}
      </main>

      {current && chatOpen && (
        <>
          <div className="lib-chat-backdrop" onClick={() => toggleChat(false)} />
          <aside className="lib-chat" aria-label="Discuss this forecast">
            <ChatPanel key={keyOf(current)} runId={current.runId} questionId={current.questionId} onClose={() => toggleChat(false)} />
          </aside>
        </>
      )}

      <style>{`
        ${vizPaletteCss(".lib")}
        ${statusCss(".lib")}
        .lib { display: flex; height: 100%; min-height: 0; }
        .lib-list { width: 320px; flex-shrink: 0; display: flex; flex-direction: column; border-right: 1px solid var(--border); background: var(--bg-subtle); min-height: 0; }
        .lib-detail { flex: 1; min-width: 0; overflow-y: auto; }
        .lib-chat { width: 400px; flex-shrink: 0; border-left: 1px solid var(--border); min-height: 0; }
        .lib-chat-backdrop { display: none; }
        .lib-menu-item:hover { background: var(--bg-hover); }
        /* Under 1200px three columns get cramped: the discussion overlays the detail instead. */
        @media (max-width: 1199px) {
          .lib-chat { position: fixed; top: 0; right: 0; bottom: 0; width: min(420px, 100vw); z-index: 30; box-shadow: -8px 0 28px rgba(0,0,0,0.18); }
          .lib-chat-backdrop { display: block; position: fixed; inset: 0; z-index: 29; background: rgba(0,0,0,0.3); }
        }
        @media (max-width: 800px) {
          .lib { flex-direction: column; overflow-y: auto; }
          .lib-list { width: 100%; max-height: 45vh; border-right: none; border-bottom: 1px solid var(--border); }
          .lib-detail { overflow-y: visible; }
        }
      `}</style>
    </div>
  );
}

function Detail({
  item,
  tab,
  onTab,
  chatOpen,
  onToggleChat,
}: {
  item: LibraryItem;
  tab: TabKey;
  onTab: (tab: TabKey) => void;
  chatOpen: boolean;
  onToggleChat: () => void;
}) {
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
        <span style={{ marginLeft: "auto", display: "flex", gap: 14, alignItems: "center" }}>
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
          <DownloadMenu runId={item.runId} questionId={item.questionId} />
          <button
            type="button"
            onClick={onToggleChat}
            aria-pressed={chatOpen}
            style={{
              padding: "4px 12px",
              borderRadius: "var(--radius)",
              border: "1px solid var(--accent)",
              background: chatOpen ? "var(--accent)" : "transparent",
              color: chatOpen ? "var(--accent-fg)" : "var(--accent)",
              cursor: "pointer",
              fontSize: 12.5,
              fontWeight: 550,
            }}
          >
            {chatOpen ? "Hide discussion" : "Discuss"}
          </button>
        </span>
      </div>

      {error && <Notice tone="warn">{error}</Notice>}
      {!detail && !error && <div style={{ marginTop: 24, color: "var(--text-faint)" }}>Loading…</div>}

      {detail && (
        <>
          <Glance detail={detail} unit={unit} />
          <DetailTabs detail={detail} unit={unit} tab={tab} onTab={onTab} diagnostics={item.diagnostics} />
        </>
      )}
    </div>
  );
}
