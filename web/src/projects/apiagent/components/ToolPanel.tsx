"use client";

import { useState } from "react";
import type { TurnCost } from "../types";

/**
 * Tool calls, rendered as the research trail.
 *
 * Mirrors the SDK's tool states by hand, as `projects/chat/components/ToolPanel.tsx`
 * does. If the SDK adds one this drifts, which is why anything unrecognised is
 * treated as "still running" — that keeps the drift harmless.
 */
export type ToolState =
  | "input-streaming"
  | "input-available"
  | "output-available"
  | "output-error"
  | "output-denied"
  | "approval-requested"
  | "approval-responded";

const SETTLED = new Set(["output-available", "output-error", "output-denied"]);

/**
 * Tier is the whole point of this project, so it gets a real badge rather than
 * a word in a sentence. Colour carries the same ordering as the text — A reads
 * as solid, C as a warning — but the letter is always present, because colour
 * alone is not a label.
 */
function TierBadge({ tier }: { tier: string }) {
  const style =
    tier === "A"
      ? { border: "var(--accent)", bg: "var(--accent-subtle)", fg: "var(--text)" }
      : tier === "C"
        ? { border: "var(--warn-border)", bg: "var(--warn-bg)", fg: "var(--warn-text)" }
        : { border: "var(--border-strong)", bg: "transparent", fg: "var(--text-muted)" };

  const explain =
    tier === "A"
      ? "Resolution-grade: documented, stable, and citable as the answer."
      : tier === "B"
        ? "Forecasting input only. Useful evidence, but not the source that settles the question."
        : "Fragile source: an undocumented endpoint. Logged, never cited as resolution.";

  return (
    <span
      title={explain}
      style={{
        fontSize: 10.5,
        fontWeight: 600,
        letterSpacing: 0.3,
        padding: "1px 5px",
        borderRadius: 4,
        whiteSpace: "nowrap",
        border: `1px solid ${style.border}`,
        background: style.bg,
        color: style.fg,
      }}
    >
      TIER {tier}
    </span>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

type FindOutput = {
  need?: string;
  candidates?: Array<{
    id?: string;
    name?: string;
    tier?: string;
    domain?: string;
  }>;
};

type CallOutput = {
  api?: string;
  name?: string;
  tier?: string;
  url?: string;
  retrievedAt?: string;
  rowCount?: number;
  truncated?: boolean;
  note?: string;
  rows?: unknown[];
  error?: string;
  problems?: string[];
  advice?: string;
  paramsHelp?: string;
  expected?: string;
  received?: string;
};

/** What the disclosure row says, per tool and state. */
function label(
  tool: string,
  state: ToolState,
  input: unknown,
  output: unknown,
): string {
  const running = !SETTLED.has(state);

  if (tool === "find_apis") {
    const need = (input as { need?: string } | undefined)?.need;
    if (running) return need ? `Looking for sources — ${need}` : "Looking for sources…";
    if (state === "output-error") return "Source lookup failed";
    const count = (output as FindOutput | undefined)?.candidates?.length ?? 0;
    return count === 0 ? "No matching sources" : `Found ${count} candidate sources`;
  }

  if (tool === "call_api") {
    const requested = (input as { api?: string } | undefined)?.api;
    const result = output as CallOutput | undefined;
    if (running) return requested ? `Calling ${requested}…` : "Calling an API…";
    if (state === "output-error") return `${requested ?? "API"} failed`;
    if (result?.error) return `${result.name ?? requested ?? "API"} — ${result.error}`;
    const rows = result?.rowCount ?? 0;
    const name = result?.name ?? requested ?? "API";
    return rows === 0 ? `${name} — no matching records` : `${name} — ${rows} rows`;
  }

  return running ? `${tool}…` : tool;
}

export function ToolPanel({
  tool,
  state,
  input,
  output,
  errorText,
}: {
  tool: string;
  state: ToolState;
  input: unknown;
  output: unknown;
  errorText?: string;
}) {
  /*
   * Open by default and stays open.
   *
   * Deliberately the opposite of the reasoning panel. Reasoning is interesting
   * while it streams and rarely afterwards; the retrieved data is the evidence,
   * and evidence that hides itself once the answer arrives defeats the purpose
   * of showing the work at all.
   */
  const [open, setOpen] = useState(true);
  const running = !SETTLED.has(state);
  const result = output as CallOutput | undefined;
  const tier = tool === "call_api" && !result?.error ? result?.tier : undefined;

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
          color: "var(--text-muted)",
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
        <span
          style={{
            fontWeight: 550,
            flex: 1,
            animation: running ? "apiPulse 1.4s ease-in-out infinite" : undefined,
          }}
        >
          {label(tool, state, input, output)}
        </span>
        {tier && <TierBadge tier={tier} />}
      </button>

      {open && (
        <div style={{ padding: "0 12px 10px", fontSize: 12.5 }}>
          {errorText && (
            <p style={{ color: "var(--danger)", margin: "0 0 8px" }}>{errorText}</p>
          )}
          {tool === "find_apis" && <FindBody output={output as FindOutput} />}
          {tool === "call_api" && <CallBody output={result} />}
        </div>
      )}

      <style>{`
        @keyframes apiPulse { 0%,100% { opacity: 1 } 50% { opacity: 0.55 } }
      `}</style>
    </div>
  );
}

function FindBody({ output }: { output?: FindOutput }) {
  const candidates = output?.candidates ?? [];
  if (candidates.length === 0) return null;

  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 4 }}>
      {candidates.map((candidate) => (
        <li
          key={candidate.id}
          style={{ display: "flex", alignItems: "center", gap: 8 }}
        >
          {candidate.tier && <TierBadge tier={candidate.tier} />}
          <span style={{ color: "var(--text)" }}>{candidate.name}</span>
          <span style={{ color: "var(--text-faint)", fontSize: 11.5 }}>
            {candidate.domain}
          </span>
        </li>
      ))}
    </ul>
  );
}

function CallBody({ output }: { output?: CallOutput }) {
  if (!output) return null;

  if (output.error) {
    return (
      <div style={{ display: "grid", gap: 6 }}>
        <p style={{ margin: 0, color: "var(--danger)" }}>{output.error}</p>
        {output.problems?.map((problem) => (
          <p key={problem} style={{ margin: 0, color: "var(--text-muted)" }}>
            • {problem}
          </p>
        ))}
        {output.expected && (
          <p style={{ margin: 0, color: "var(--text-muted)" }}>
            Expected {output.expected}; received {output.received}
          </p>
        )}
        {(output.advice ?? output.paramsHelp) && (
          <p style={{ margin: 0, color: "var(--text-faint)" }}>
            {output.advice ?? output.paramsHelp}
          </p>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 8 }}>
      {/*
        * The provenance line. §3 requires the retrieval URL AND the timestamp
        * for anything below Tier A, and there is no reason to show less for
        * Tier A — this is the audit trail, rendered.
        */}
      {output.url && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "baseline" }}>
          <a
            href={output.url}
            target="_blank"
            rel="noopener noreferrer nofollow"
            style={{ color: "var(--accent)", wordBreak: "break-all" }}
          >
            {hostOf(output.url)}
          </a>
          {output.retrievedAt && (
            <span style={{ color: "var(--text-faint)", fontSize: 11.5 }}>
              retrieved {new Date(output.retrievedAt).toLocaleTimeString()}
            </span>
          )}
          {output.truncated && (
            <span style={{ color: "var(--text-faint)", fontSize: 11.5 }}>
              truncated
            </span>
          )}
        </div>
      )}

      {output.note && (
        <p style={{ margin: 0, color: "var(--text-muted)" }}>{output.note}</p>
      )}

      {/*
        * Raw rows, scrolling in their own box.
        *
        * Rows are heterogeneous across forty-three APIs, so a table would need
        * per-adapter layout to be worth having. JSON is honest about what the
        * model actually received, which is the thing a reader checking an
        * answer wants to see.
        */}
      {output.rows && output.rows.length > 0 && (
        <pre
          style={{
            margin: 0,
            maxHeight: 220,
            overflow: "auto",
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            padding: "8px 10px",
            fontFamily: "var(--font-mono)",
            fontSize: 11.5,
            lineHeight: 1.55,
          }}
        >
          {JSON.stringify(output.rows, null, 1)}
        </pre>
      )}
    </div>
  );
}

/**
 * What the turn cost, and what it rests on.
 *
 * Built by omission, like `TurnCostLine` in the chat project, with one addition
 * that matters: an answer resting only on Tier B sources is called out. The
 * model is instructed to say so itself, but this says it whether or not the
 * model complied.
 */
export function TurnCostLine({ cost }: { cost?: TurnCost }) {
  if (!cost) return null;

  const parts: string[] = [];
  if (cost.model) parts.push(cost.model);

  if (cost.calls === 0 && cost.lookups === 0) {
    parts.push("no sources consulted");
  } else {
    if (cost.lookups) parts.push(`${cost.lookups} lookup${cost.lookups === 1 ? "" : "s"}`);
    if (cost.calls) parts.push(`${cost.calls} API call${cost.calls === 1 ? "" : "s"}`);
    if (cost.failures) parts.push(`${cost.failures} failed`);
  }

  if (cost.totalTokens) parts.push(`${cost.totalTokens.toLocaleString()} tokens`);

  const tiers = cost.tiersUsed ?? [];
  const weak = tiers.length > 0 && !tiers.includes("A");

  return (
    <p style={{ fontSize: 11.5, color: "var(--text-faint)", margin: "10px 0 0" }}>
      {parts.join(" · ")}
      {tiers.length > 0 && ` · tier ${tiers.join("+")}`}
      {weak && (
        <span style={{ color: "var(--warn-text)" }}>
          {" "}
          — no resolution-grade source was used
        </span>
      )}
    </p>
  );
}

/** The retrieval log, restored from storage on a reopened conversation. */
export function SavedSources({
  sources,
}: {
  sources: Array<{ url: string; title?: string }>;
}) {
  if (sources.length === 0) return null;

  return (
    <div style={{ marginTop: 10, fontSize: 12 }}>
      <p style={{ margin: "0 0 4px", color: "var(--text-muted)", fontWeight: 550 }}>
        Sources retrieved
      </p>
      <ol style={{ margin: 0, paddingLeft: 20, color: "var(--text-muted)" }}>
        {sources.map((source) => (
          <li key={source.url} style={{ margin: "2px 0" }}>
            <a
              href={source.url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              style={{ color: "var(--accent)" }}
            >
              {source.title ?? hostOf(source.url)}
            </a>
          </li>
        ))}
      </ol>
    </div>
  );
}
