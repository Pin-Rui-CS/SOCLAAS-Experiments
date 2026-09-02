"use client";

import { useState } from "react";

/**
 * What the model did on the web, shown rather than summarised away.
 *
 * Deliberately the same disclosure grammar as ReasoningPanel: a row you can
 * expand, a live label while it runs, a settled one after. The difference is
 * that this one stays OPEN once it has results. Reasoning is interesting while
 * it streams and rarely afterwards; sources are the evidence, and an answer
 * that merely sounds grounded is exactly the thing a reader needs to check.
 */

/**
 * Mirrors the SDK's tool-part states. The approval ones cannot occur here —
 * neither tool asks for approval — but the type has to cover them, and
 * treating anything unsettled as "still running" keeps that harmless.
 */
export type ToolState =
  | "input-streaming"
  | "input-available"
  | "output-available"
  | "output-error"
  | "output-denied"
  | "approval-requested"
  | "approval-responded";

type SearchResult = {
  title: string;
  url: string;
  snippet: string;
  publishedAt?: string;
};

type SearchOutput = {
  query?: string;
  provider?: string;
  results?: SearchResult[];
  error?: string;
};

type FetchOutput = {
  url?: string;
  title?: string;
  text?: string;
  truncated?: boolean;
  error?: string;
  blocked?: boolean;
};

export function ToolPanel({
  tool,
  state,
  input,
  output,
  errorText,
}: {
  /** "web_search" or "web_fetch". */
  tool: string;
  state: ToolState;
  input: unknown;
  output: unknown;
  errorText?: string;
}) {
  const running =
    state !== "output-available" &&
    state !== "output-error" &&
    state !== "output-denied";
  const [open, setOpen] = useState(true);

  const query = (input as { query?: string } | undefined)?.query;
  const url = (input as { url?: string } | undefined)?.url;

  const search = tool === "web_search" ? (output as SearchOutput | undefined) : undefined;
  const page = tool === "web_fetch" ? (output as FetchOutput | undefined) : undefined;

  const failure = errorText ?? search?.error ?? page?.error;
  const results = search?.results ?? [];

  const label = (() => {
    if (tool === "web_search") {
      if (running) return query ? `Searching for “${query}”…` : "Searching…";
      if (failure) return "Search failed";
      return results.length === 0
        ? "No results"
        : `Searched the web — ${results.length} result${results.length === 1 ? "" : "s"}`;
    }

    if (running) return url ? `Reading ${hostOf(url)}…` : "Reading a page…";
    if (page?.blocked) return "Blocked that address";
    if (failure) return "Could not read the page";
    return `Read ${page?.title || hostOf(page?.url ?? url ?? "")}`;
  })();

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
        background: "var(--bg-subtle)",
        marginBottom: 10,
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "7px 12px",
          background: "none",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
          color: failure ? "var(--danger)" : "var(--text-muted)",
          fontSize: 12.5,
        }}
      >
        <span
          style={{
            transform: open ? "rotate(90deg)" : "none",
            transition: "transform 120ms",
          }}
        >
          ▶
        </span>
        <span style={{ fontWeight: 550, flex: 1 }}>
          {running ? (
            <span style={{ animation: "pulse 1.4s ease-in-out infinite" }}>{label}</span>
          ) : (
            label
          )}
        </span>
        {search?.provider && !running && !failure && (
          <span style={{ color: "var(--text-faint)", fontSize: 11 }}>
            {search.provider}
          </span>
        )}
      </button>

      {open && !running && (
        <div style={{ padding: "0 12px 10px" }}>
          {failure && (
            <p style={{ margin: 0, fontSize: 12.5, color: "var(--danger)" }}>{failure}</p>
          )}

          {!failure && tool === "web_search" && results.length > 0 && (
            <ol style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, lineHeight: 1.5 }}>
              {results.map((result) => (
                <li key={result.url} style={{ marginBottom: 6 }}>
                  <a
                    href={result.url}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    style={{ textDecoration: "underline" }}
                  >
                    {result.title}
                  </a>
                  <div style={{ color: "var(--text-faint)", fontSize: 11 }}>
                    {hostOf(result.url)}
                    {result.publishedAt ? ` · ${result.publishedAt.slice(0, 10)}` : ""}
                  </div>
                </li>
              ))}
            </ol>
          )}

          {!failure && tool === "web_fetch" && page?.url && (
            <p style={{ margin: 0, fontSize: 12.5 }}>
              <a
                href={page.url}
                target="_blank"
                rel="noopener noreferrer nofollow"
                style={{ textDecoration: "underline" }}
              >
                {page.url}
              </a>
              {page.truncated && (
                <span style={{ color: "var(--text-faint)" }}> · truncated</span>
              )}
            </p>
          )}
        </div>
      )}

      <style>{`@keyframes pulse { 0%,100% { opacity: .45 } 50% { opacity: 1 } }`}</style>
    </div>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * Sources on a REOPENED conversation.
 *
 * A live turn shows ToolPanel, which has the query, the provider and the state.
 * None of that survives a reload — only the links do — so this is the reduced
 * form: the evidence, without the story of how it was gathered.
 */
export function SavedSources({
  sources,
}: {
  sources: Array<{ url: string; title?: string }>;
}) {
  if (sources.length === 0) return null;

  return (
    <div
      style={{
        borderTop: "1px solid var(--border)",
        marginTop: 10,
        paddingTop: 8,
        fontSize: 12,
        color: "var(--text-faint)",
      }}
    >
      <span style={{ fontWeight: 550 }}>Sources</span>
      <ul
        style={{
          listStyle: "none",
          margin: "4px 0 0",
          padding: 0,
          display: "flex",
          flexWrap: "wrap",
          gap: "4px 10px",
        }}
      >
        {sources.map((source) => (
          <li key={source.url}>
            <a
              href={source.url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              title={source.title ?? source.url}
              style={{ textDecoration: "underline" }}
            >
              {hostOf(source.url)}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
