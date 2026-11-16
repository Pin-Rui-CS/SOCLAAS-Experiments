"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The Discuss chat's message parts. Adapted from the Chat project's panels —
 * duplicated, not imported, because projects never import each other — and
 * trimmed to a side panel's width.
 */

/** The model's thinking: open while it streams, folded once the answer starts. */
export function ReasoningPanel({ text, streaming }: { text: string; streaming: boolean }) {
  // null until the reader clicks; until then it simply follows the stream.
  const [manual, setManual] = useState<boolean | null>(null);
  const open = manual ?? streaming;
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && streaming && bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [text, open, streaming]);

  if (!text.trim()) return null;
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: "var(--radius)", background: "var(--bg-subtle)", marginBottom: 8 }}>
      <button
        type="button"
        onClick={() => setManual(!open)}
        aria-expanded={open}
        style={{ ...rowButton, color: "var(--text-muted)" }}
      >
        <Caret open={open} />
        <span style={{ fontWeight: 550 }}>{streaming ? "Thinking…" : "Reasoning"}</span>
        <span style={{ color: "var(--text-faint)" }}>{text.length.toLocaleString()} chars</span>
      </button>
      {open && (
        <div
          ref={bodyRef}
          style={{
            maxHeight: 220,
            overflowY: "auto",
            padding: "0 10px 8px",
            fontFamily: "var(--font-mono)",
            fontSize: 11.5,
            lineHeight: 1.55,
            color: "var(--text-muted)",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {text}
        </div>
      )}
    </div>
  );
}

type ToolRowProps = { tool: string; state: string; input: unknown; output: unknown; errorText?: string };

/** One line per tool call; web results expand to their links. */
export function ToolRow({ tool, state, input, output, errorText }: ToolRowProps) {
  const [open, setOpen] = useState(false);
  const running = state !== "output-available" && state !== "output-error";
  const i = (input ?? {}) as Record<string, unknown>;
  const o = (output ?? {}) as Record<string, unknown>;

  let label: string;
  let links: { url: string; title?: string }[] = [];
  let problem = errorText ?? (typeof o.error === "string" ? o.error : undefined);

  if (tool === "read_forecast_file") {
    const where = `${i.file ?? "file"}${i.section ? ` › ${i.section}` : ""}`;
    const page = typeof o.offset === "number" && o.offset > 0 ? ` (from char ${o.offset.toLocaleString()})` : "";
    label = running ? `Reading ${where}…` : `Read ${where}${page}`;
    if (!problem && typeof o.totalChars === "number") label += ` · ${Math.round(o.totalChars / 1000)}K chars`;
    if (Array.isArray(o.sections) && problem) problem += ` — has: ${(o.sections as string[]).join(", ")}`;
  } else if (tool === "web_search") {
    label = running ? `Searching “${i.query ?? ""}”…` : `Searched “${i.query ?? ""}”`;
    links = ((o.results as { url: string; title?: string }[]) ?? []).map((r) => ({ url: r.url, title: r.title }));
    if (!running && !problem) label += ` · ${links.length} results`;
  } else if (tool === "web_fetch") {
    const url = String(i.url ?? o.url ?? "");
    label = running ? `Reading ${hostOf(url)}…` : `Read ${hostOf(url)}`;
    if (url) links = [{ url, title: typeof o.title === "string" ? o.title : undefined }];
  } else {
    label = tool;
  }

  return (
    <div style={{ marginBottom: 6, fontSize: 12.5 }}>
      <button
        type="button"
        onClick={() => links.length && setOpen(!open)}
        aria-expanded={links.length ? open : undefined}
        style={{ ...rowButton, padding: "3px 0", cursor: links.length ? "pointer" : "default", color: problem ? "var(--warn-text)" : "var(--text-muted)" }}
      >
        {links.length > 0 ? <Caret open={open} /> : <span aria-hidden style={{ width: 10, textAlign: "center" }}>{running ? "◌" : "✓"}</span>}
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
      </button>
      {problem && <div style={{ color: "var(--warn-text)", fontSize: 12, paddingLeft: 18 }}>{problem}</div>}
      {open && <Links links={links} />}
    </div>
  );
}

/** Links kept from web tools on a reopened thread, where the tool rows are gone. */
export function SavedSources({ sources }: { sources: { url: string; title?: string }[] }) {
  const [open, setOpen] = useState(false);
  if (!sources.length) return null;
  return (
    <div style={{ fontSize: 12.5, marginTop: 6 }}>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} style={{ ...rowButton, padding: "3px 0", color: "var(--text-muted)" }}>
        <Caret open={open} />
        {sources.length} web source{sources.length === 1 ? "" : "s"}
      </button>
      {open && <Links links={sources} />}
    </div>
  );
}

export type TurnCost = {
  web?: boolean;
  searchProvider?: string;
  searchProviderId?: string;
  searches?: number;
  pagesRead?: number;
  credits?: number;
  fileReads?: number;
  inputTokens?: number;
  outputTokens?: number;
};

/** What a finished turn read and spent, in one faint line. */
export function TurnCostLine({ cost }: { cost: TurnCost | undefined }) {
  if (!cost) return null;
  const parts: string[] = [];
  if (cost.fileReads) parts.push(`${cost.fileReads} file read${cost.fileReads === 1 ? "" : "s"}`);
  if (cost.web) {
    if (cost.searches) parts.push(`${cost.searches} search${cost.searches === 1 ? "" : "es"}`);
    if (cost.pagesRead) parts.push(`${cost.pagesRead} page${cost.pagesRead === 1 ? "" : "s"} read`);
    if (cost.credits) parts.push(`${cost.credits} ${cost.searchProvider ?? "search"} credit${cost.credits === 1 ? "" : "s"}`);
  }
  if (typeof cost.inputTokens === "number") {
    parts.push(`${cost.inputTokens.toLocaleString()} in / ${(cost.outputTokens ?? 0).toLocaleString()} out tokens`);
  }
  if (!parts.length) return null;
  return <div style={{ marginTop: 6, fontSize: 11, color: "var(--text-faint)" }}>{parts.join(" · ")}</div>;
}

function Links({ links }: { links: { url: string; title?: string }[] }) {
  return (
    <ul style={{ listStyle: "none", margin: "2px 0 4px", padding: "0 0 0 18px", display: "grid", gap: 3 }}>
      {links.map((l) => (
        <li key={l.url} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          <a href={l.url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)" }} title={l.url}>
            {l.title || hostOf(l.url)}
          </a>
          <span style={{ color: "var(--text-faint)" }}> · {hostOf(l.url)}</span>
        </li>
      ))}
    </ul>
  );
}

function Caret({ open }: { open: boolean }) {
  return (
    <span aria-hidden style={{ display: "inline-block", width: 10, fontSize: 9, transform: open ? "rotate(90deg)" : "none", transition: "transform 120ms" }}>
      ▶
    </span>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

const rowButton = {
  width: "100%",
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "6px 10px",
  background: "none",
  border: "none",
  cursor: "pointer",
  textAlign: "left",
  fontSize: 12.5,
} as const;
