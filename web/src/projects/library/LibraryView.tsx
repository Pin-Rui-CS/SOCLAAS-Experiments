"use client";

import { useEffect, useMemo, useState } from "react";
import { fileUrl, getJson, keyOf, typeLabel } from "./api";
import { buildPipelineGraph, type SelectionTarget } from "./pipeline";
import { useCompetitions } from "./useCompetitions";
import { BentoSummary } from "./components/BentoSummary";
import { ChatPanel } from "./components/ChatPanel";
import { DiagnosticsPanel, statusCss } from "./components/Diagnostics";
import { vizPaletteCss } from "./components/DistributionCharts";
import { DownloadMenu } from "./components/DownloadMenu";
import { ForecastList } from "./components/ForecastList";
import { InspectorDrawer } from "./components/InspectorDrawer";
import { PipelineCanvas } from "./components/PipelineCanvas";
import { TracePanel } from "./components/trace/TracePanel";
import { formatDate } from "./components/Value";
import { Notice } from "./components/ui";
import type { ForecastDetail, LibraryItem, LineageRecord } from "./types";

type CanvasMode = "pipeline" | "diagnostics" | "trace";

const MODE_STORAGE_KEY = "soclaas.library.canvasMode";
const LIST_COLLAPSE_KEY = "soclaas.library.listCollapsed";

function readInitialMode(): CanvasMode {
  try {
    const v = localStorage.getItem(MODE_STORAGE_KEY);
    if (v === "pipeline" || v === "diagnostics" || v === "trace") return v;
  } catch {
    // default below
  }
  return "pipeline";
}

export default function LibraryView() {
  const [rawItems, setRawItems] = useState<LibraryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<CanvasMode>(readInitialMode);
  const [listCollapsed, setListCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(LIST_COLLAPSE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [chatOpen, setChatOpen] = useState(false);

  const { items, pending, failed } = useCompetitions(rawItems);

  useEffect(() => {
    getJson<{ items: LibraryItem[] }>("view=list")
      .then(({ items }) => {
        setRawItems(items);
        if (items.length) setSelected((current) => current ?? keyOf(items[0]));
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  const chooseMode = (next: CanvasMode) => {
    setMode(next);
    try {
      localStorage.setItem(MODE_STORAGE_KEY, next);
    } catch {
      // per-browser convenience only
    }
  };

  const toggleList = () => {
    setListCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(LIST_COLLAPSE_KEY, next ? "1" : "0");
      } catch {
        // ignore
      }
      return next;
    });
  };

  useEffect(() => {
    if (!chatOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setChatOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [chatOpen]);

  const current = items?.find((i) => keyOf(i) === selected) ?? null;

  return (
    <div className="lib">
      <ForecastList
        items={items}
        selected={selected}
        onSelect={setSelected}
        collapsed={listCollapsed}
        onToggleCollapse={toggleList}
        pendingLookups={pending}
        lookupError={failed}
        error={error}
      />

      <main className="lib-detail">
        {current ? (
          <ForecastWorkspace
            key={keyOf(current)}
            item={current}
            mode={mode}
            onMode={chooseMode}
            chatOpen={chatOpen}
            onToggleChat={() => setChatOpen((v) => !v)}
          />
        ) : (
          !error && (
            <div style={{ padding: 32, color: "var(--text-faint)", fontSize: 13 }}>
              {items ? "Select a forecast." : "Loading forecasts…"}
            </div>
          )
        )}
      </main>

      {/* Slide-over Discuss Drawer (occupies zero permanent width) */}
      {current && chatOpen && (
        <>
          <div className="lib-chat-backdrop" onClick={() => setChatOpen(false)} />
          <aside className="lib-chat" aria-label="Discuss this forecast">
            <ChatPanel
              key={keyOf(current)}
              runId={current.runId}
              questionId={current.questionId}
              onClose={() => setChatOpen(false)}
            />
          </aside>
        </>
      )}

      <style>{`
        ${vizPaletteCss(".lib")}
        ${statusCss(".lib")}
        .lib { display: flex; height: 100%; min-height: 0; background: var(--bg); }
        .lib-list {
          width: 286px;
          flex-shrink: 0;
          display: flex;
          flex-direction: column;
          border-right: 1px solid var(--border);
          background: var(--bg-subtle);
          min-height: 0;
          transition: width 150ms ease;
        }
        .lib-list-collapsed {
          width: 42px;
          align-items: center;
          padding-top: 12px;
        }
        .lib-row:hover { background: var(--bg-hover); }
        .lib-detail { flex: 1; min-width: 0; overflow-y: auto; }
        .lib-menu-item:hover, .lib-hover-surface:hover { background: var(--bg-hover) !important; }

        .lib-bento {
          display: grid;
          grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
          gap: 12px;
          align-items: stretch;
        }
        @media (max-width: 980px) {
          .lib-bento { grid-template-columns: 1fr; }
        }

        .lib-dag-surface {
          position: relative;
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 18px 18px 22px;
          background-color: var(--bg-subtle);
          background-image: radial-gradient(var(--border-strong) 0.75px, transparent 0.75px);
          background-size: 18px 18px;
          overflow: hidden;
        }
        .lib-dag-node:hover {
          border-color: var(--border-strong) !important;
          transform: translateY(-0.5px);
        }
        .lib-dag-cols-3 {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 12px;
          align-items: start;
        }

        .lib-chat {
          position: fixed;
          top: 0;
          right: 0;
          bottom: 0;
          width: min(440px, 95vw);
          z-index: 46;
          border-left: 1px solid var(--border);
          box-shadow: -10px 0 32px rgba(0,0,0,0.2);
          animation: libSlideIn 160ms cubic-bezier(0.16, 1, 0.3, 1);
        }
        .lib-chat-backdrop {
          position: fixed;
          inset: 0;
          z-index: 45;
          background: rgba(0,0,0,0.3);
          animation: libFadeIn 140ms ease;
        }

        @keyframes libSlideIn {
          from { transform: translateX(24px); opacity: 0.6; }
          to { transform: translateX(0); opacity: 1; }
        }
        @keyframes libFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        @media (max-width: 800px) {
          .lib { flex-direction: column; overflow-y: auto; }
          .lib-list { width: 100%; max-height: 40vh; border-right: none; border-bottom: 1px solid var(--border); }
          .lib-list-collapsed { width: 100%; max-height: none; flex-direction: row; padding: 8px 12px; gap: 10px; }
          .lib-collapse-btn { display: none; }
          .lib-detail { overflow-y: visible; }
        }
      `}</style>
    </div>
  );
}

/* ----------------------------------------------------- Forecast Workspace */

function ForecastWorkspace({
  item,
  mode: preferredMode,
  onMode,
  chatOpen,
  onToggleChat,
}: {
  item: LibraryItem;
  mode: CanvasMode;
  onMode: (mode: CanvasMode) => void;
  chatOpen: boolean;
  onToggleChat: () => void;
}) {
  const [detail, setDetail] = useState<ForecastDetail | null>(null);
  const [researchText, setResearchText] = useState<string | null>(null);
  const [lineageRecord, setLineageRecord] = useState<LineageRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inspector, setInspector] = useState<SelectionTarget | null>(null);
  const [copiedPost, setCopiedPost] = useState(false);

  // Hydrate structured detail immediately, plus research sections & optional lineage in parallel
  useEffect(() => {
    let cancelled = false;

    getJson<ForecastDetail>(`view=forecast&run=${encodeURIComponent(item.runId)}&q=${item.questionId}`)
      .then((d) => !cancelled && setDetail(d))
      .catch((e: Error) => !cancelled && setError(e.message));

    getJson<{ text: string | null }>(fileUrl(item.runId, item.questionId, "research"))
      .then(({ text }) => !cancelled && setResearchText(text))
      .catch(() => {
        // Optional enrichment: graph still renders from ForecastDetail alone
      });

    if (item.hasLineage) {
      getJson<{ record: LineageRecord | null }>(
        `view=lineage&run=${encodeURIComponent(item.runId)}&q=${item.questionId}`,
      )
        .then(({ record }) => !cancelled && setLineageRecord(record))
        .catch(() => {
          // Optional enrichment
        });
    }

    return () => {
      cancelled = true;
    };
  }, [item.runId, item.questionId, item.hasLineage]);

  const graph = useMemo(
    () => (detail ? buildPipelineGraph(detail, researchText, lineageRecord?.lineage ?? null) : null),
    [detail, researchText, lineageRecord],
  );

  // Fall back to "pipeline" if the remembered mode is unavailable on this forecast
  const activeMode: CanvasMode =
    (preferredMode === "diagnostics" && !item.diagnostics) ||
    (preferredMode === "trace" && !item.hasLineage)
      ? "pipeline"
      : preferredMode;

  const unit = detail?.question.unit ?? item.unit;
  const competition = item.competitions?.map((c) => c.name ?? c.slug).join(", ");

  const copyPostId = () => {
    if (!item.postId) return;
    void navigator.clipboard?.writeText(String(item.postId)).then(() => {
      setCopiedPost(true);
      setTimeout(() => setCopiedPost(false), 1500);
    });
  };

  return (
    <div style={{ maxWidth: activeMode === "trace" ? "none" : 1140, margin: "0 auto", padding: "18px 24px 60px" }}>
      {/* Compact Sticky-Style Header */}
      <header>
        <h1 style={{ fontSize: 19, fontWeight: 620, letterSpacing: "-0.012em", margin: 0, lineHeight: 1.32 }}>
          {item.title}
        </h1>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: "6px 8px",
            marginTop: 8,
            fontSize: 12,
            color: "var(--text-muted)",
          }}
        >
          {/* Question ID & 1-Click Copy Post ID */}
          <span style={metaPill} title="Metaculus Question ID">
            Q {item.questionId}
          </span>
          {item.postId && (
            <button
              type="button"
              onClick={copyPostId}
              className="lib-hover-surface"
              title="Click to copy Metaculus Post ID"
              style={{
                ...metaPill,
                cursor: "pointer",
                color: copiedPost ? "var(--st-pass)" : "var(--text)",
                borderColor: copiedPost ? "var(--st-pass)" : "var(--border)",
              }}
            >
              {copiedPost ? `Post ${item.postId} ✓` : `Post ${item.postId} ⧉`}
            </button>
          )}
          <span style={metaPill}>{typeLabel(item.type)}</span>
          {competition && <span>· {competition}</span>}
          <span>· {formatDate(item.runAt)}</span>
          {item.abstained ? (
            <span style={{ color: "var(--warn-text)" }}>· abstained</span>
          ) : item.submitted ? (
            <span style={{ color: "var(--st-pass)" }}>· submitted</span>
          ) : (
            <span style={{ color: "var(--warn-text)" }}>· dry run</span>
          )}

          {/* Right Quick Actions */}
          <span style={{ marginLeft: "auto", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
            <button
              type="button"
              onClick={() => setInspector({ kind: "question" })}
              style={actionBtn}
            >
              Criteria &amp; Live
            </button>
            <button
              type="button"
              onClick={() => setInspector({ kind: "files" })}
              style={actionBtn}
            >
              Files
            </button>
            {item.postId && (
              <a
                href={`https://www.metaculus.com/questions/${item.postId}/`}
                target="_blank"
                rel="noopener noreferrer"
                style={linkStyle}
              >
                Metaculus ↗
              </a>
            )}
            {detail?.runUrl && (
              <a href={detail.runUrl} target="_blank" rel="noopener noreferrer" style={linkStyle}>
                GitHub ↗
              </a>
            )}
            <DownloadMenu runId={item.runId} questionId={item.questionId} />
            <button
              type="button"
              onClick={onToggleChat}
              aria-pressed={chatOpen}
              style={{
                padding: "3px 11px",
                borderRadius: 6,
                border: "1px solid var(--accent)",
                background: chatOpen ? "var(--accent)" : "transparent",
                color: chatOpen ? "var(--accent-fg)" : "var(--accent)",
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 560,
              }}
            >
              Discuss
            </button>
          </span>
        </div>
      </header>

      {error && <Notice tone="warn">{error}</Notice>}
      {!detail && !error && (
        <div style={{ marginTop: 24, color: "var(--text-faint)", fontSize: 13 }}>Loading forecast…</div>
      )}

      {detail && graph && (
        <>
          {/* Top 2-Card Bento Summary */}
          <BentoSummary
            detail={detail}
            unit={unit}
            graph={graph}
            onSelect={setInspector}
          />

          {/* Main Canvas Mode Bar */}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              marginTop: 18,
              marginBottom: 6,
            }}
          >
            <div
              role="tablist"
              aria-label="Workspace view"
              style={{
                display: "inline-flex",
                gap: 2,
                padding: 3,
                borderRadius: 8,
                background: "var(--bg-subtle)",
                border: "1px solid var(--border)",
              }}
            >
              <ModeButton
                active={activeMode === "pipeline"}
                onClick={() => onMode("pipeline")}
              >
                Pipeline Map
              </ModeButton>
              {item.diagnostics && (
                <ModeButton
                  active={activeMode === "diagnostics"}
                  onClick={() => onMode("diagnostics")}
                >
                  Diagnostics
                  <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 600 }}>
                    {item.diagnostics.fails > 0 && (
                      <span style={{ color: "var(--st-fail)" }}>{item.diagnostics.fails} fail</span>
                    )}
                    {item.diagnostics.fails > 0 && item.diagnostics.warns > 0 && " · "}
                    {item.diagnostics.warns > 0 && (
                      <span style={{ color: "var(--st-warn)" }}>{item.diagnostics.warns} warn</span>
                    )}
                    {!item.diagnostics.fails && !item.diagnostics.warns && (
                      <span style={{ color: "var(--st-pass)" }}>ok</span>
                    )}
                  </span>
                </ModeButton>
              )}
              {item.hasLineage && (
                <ModeButton
                  active={activeMode === "trace"}
                  onClick={() => onMode("trace")}
                >
                  Lineage Table
                </ModeButton>
              )}
            </div>
          </div>

          {/* Main Canvas Body */}
          {activeMode === "pipeline" && (
            <PipelineCanvas
              graph={graph}
              selected={inspector}
              onSelect={setInspector}
            />
          )}
          {activeMode === "diagnostics" && (
            <DiagnosticsPanel
              runId={detail.runId}
              questionId={detail.questionId}
              summary={item.diagnostics}
            />
          )}
          {activeMode === "trace" && (
            <TracePanel runId={detail.runId} questionId={detail.questionId} />
          )}

          {/* On-Demand Slide-Over Inspector Drawer */}
          {inspector && (
            <InspectorDrawer
              target={inspector}
              detail={detail}
              unit={unit}
              graph={graph}
              onSelect={setInspector}
              onClose={() => setInspector(null)}
            />
          )}
        </>
      )}
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      style={{
        padding: "4px 12px",
        borderRadius: 6,
        border: "none",
        background: active ? "var(--bg-raised)" : "transparent",
        boxShadow: active ? "0 1px 2px rgba(0,0,0,0.08)" : "none",
        color: active ? "var(--text)" : "var(--text-muted)",
        fontSize: 12.5,
        fontWeight: active ? 600 : 460,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

const metaPill = {
  display: "inline-flex",
  alignItems: "center",
  padding: "1px 7px",
  borderRadius: 5,
  border: "1px solid var(--border)",
  background: "var(--bg-subtle)",
  fontFamily: "var(--font-mono)",
  fontSize: 11.5,
  fontVariantNumeric: "tabular-nums",
  color: "var(--text)",
} as const;

const actionBtn = {
  padding: "2px 8px",
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "var(--bg-raised)",
  color: "var(--text-muted)",
  fontSize: 12,
  cursor: "pointer",
} as const;

const linkStyle = {
  color: "var(--accent)",
  fontSize: 12,
} as const;
