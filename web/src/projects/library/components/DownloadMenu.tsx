"use client";

import { useEffect, useRef, useState } from "react";
import { getJson } from "../api";

/** Everything first, then each file, then the brief — the order people reach for them. */
const ENTRIES: { key: string; label: string; hint?: string }[] = [
  { key: "all", label: "Everything (.zip)" },
  { key: "forecast", label: "forecast.json", hint: "the full record" },
  { key: "research", label: "research.md", hint: "all research + the brief" },
  { key: "runs", label: "runs.md", hint: "prompt + every run's reasoning" },
  { key: "evolution", label: "evolution.md" },
  { key: "audit", label: "audit.md", hint: "tokens, cost, sources" },
  { key: "trace", label: "trace.tar.gz", hint: "every scrape and prompt" },
  { key: "brief", label: "Brief for another AI (.md)", hint: "the whole forecast in one file" },
];

type Listing = { prefix: string; files: Record<string, number | null> };

export function downloadHref(runId: string, questionId: number, file: string) {
  return `/api/projects/library?view=download&run=${encodeURIComponent(runId)}&q=${questionId}&file=${file}`;
}

function size(bytes: number | null | undefined): string {
  if (bytes == null) return "";
  return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * A question's files, for use outside the library. Plain links: the browser
 * downloads them itself, and the session cookie authorises them through the
 * site's gate like any other request.
 */
export function DownloadMenu({ runId, questionId }: { runId: string; questionId: number }) {
  const [open, setOpen] = useState(false);
  const [listing, setListing] = useState<Listing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);

  // What exists and how big it is, fetched the first time the menu opens.
  useEffect(() => {
    if (!open || listing) return;
    getJson<Listing>(`view=downloads&run=${encodeURIComponent(runId)}&q=${questionId}`)
      .then(setListing)
      .catch((e: Error) => setError(e.message));
  }, [open, listing, runId, questionId]);

  // Close on a click outside or Escape, as menus do.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => root.current && !root.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: globalThis.KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const total = listing ? Object.values(listing.files).reduce<number>((n, v) => n + (v ?? 0), 0) : null;

  return (
    <div ref={root} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        style={{ border: "none", background: "none", padding: 0, cursor: "pointer", color: "var(--accent)", fontSize: 12.5 }}
      >
        Download ▾
      </button>
      {open && (
        <div
          role="menu"
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 6px)",
            zIndex: 20,
            width: 290,
            background: "var(--bg-raised)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            boxShadow: "0 6px 24px rgba(0,0,0,0.14)",
            padding: 4,
          }}
        >
          {error && <div style={{ padding: "8px 10px", fontSize: 12.5, color: "var(--warn-text)" }}>{error}</div>}
          {ENTRIES.map(({ key, label, hint }, i) => {
            const bytes = key === "all" ? total : listing?.files[key];
            const missing = listing && key !== "all" && listing.files[key] == null;
            return (
              <div key={key}>
                {(i === 1 || i === ENTRIES.length - 1) && <div style={{ height: 1, background: "var(--border)", margin: "4px 6px" }} />}
                {missing ? (
                  <div style={{ ...item, color: "var(--text-faint)", cursor: "default" }}>
                    <span>{label}</span>
                    <span style={{ fontSize: 11.5 }}>not produced</span>
                  </div>
                ) : (
                  <a role="menuitem" className="lib-menu-item" href={downloadHref(runId, questionId, key)} download onClick={() => setOpen(false)} style={item}>
                    <span style={{ minWidth: 0 }}>
                      <span style={{ fontWeight: key === "all" ? 600 : 450 }}>{label}</span>
                      {hint && <span style={{ display: "block", fontSize: 11.5, color: "var(--text-faint)" }}>{hint}</span>}
                    </span>
                    <span style={{ fontSize: 11.5, color: "var(--text-muted)", flexShrink: 0 }}>{listing ? size(bytes) : "…"}</span>
                  </a>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const item = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 10,
  padding: "6px 10px",
  borderRadius: 6,
  fontSize: 13,
  color: "var(--text)",
  textDecoration: "none",
} as const;
