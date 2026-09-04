"use client";

import { useEffect, useRef } from "react";

export function Composer({
  value,
  onChange,
  onSubmit,
  onStop,
  busy,
  disabled,
  web,
  onWebChange,
  webProviders,
  webProvider,
  onWebProviderChange,
  webSupported,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  busy: boolean;
  disabled: boolean;
  /** Whether the next message may use web tools. */
  web: boolean;
  onWebChange: (web: boolean) => void;
  /** Every search provider with a key configured. Empty means no web access. */
  webProviders: Array<{ id: string; name: string }>;
  /** Which of them to search with. */
  webProvider: string;
  onWebProviderChange: (id: string) => void;
  /** Whether the selected model is verified to emit tool calls. */
  webSupported: boolean;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Grow with the content, up to a point, then scroll inside.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [value]);

  return (
    <div
      style={{
        borderTop: "1px solid var(--border)",
        background: "var(--bg)",
        padding: "12px 16px 16px",
        flexShrink: 0,
      }}
    >
      <div style={{ maxWidth: 780, margin: "0 auto" }}>
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            gap: 8,
            border: "1px solid var(--border-strong)",
            borderRadius: 12,
            padding: 8,
            background: "var(--bg-raised)",
          }}
        >
          <textarea
            ref={textareaRef}
            rows={1}
            value={value}
            disabled={disabled}
            placeholder={disabled ? "Loading models…" : "Send a message…"}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (!busy && value.trim()) onSubmit();
              }
            }}
            style={{
              flex: 1,
              resize: "none",
              border: "none",
              outline: "none",
              background: "transparent",
              padding: "6px 6px",
              maxHeight: 200,
              lineHeight: 1.5,
            }}
          />

          {/*
            * Hidden entirely when no search provider is configured — offering a
            * switch that cannot work is worse than not offering one.
            */}
          {webProviders.length > 0 && (
            <button
              type="button"
              onClick={() => onWebChange(!web)}
              disabled={busy || !webSupported}
              aria-pressed={web && webSupported}
              title={
                webSupported
                  ? "Let the model search and read the web. It decides whether a search actually helps."
                  : "This model is not verified to emit tool calls, so web access is unavailable for it. Pick another model."
              }
              style={{
                flexShrink: 0,
                padding: "7px 12px",
                borderRadius: 8,
                fontSize: 13,
                cursor: busy || !webSupported ? "default" : "pointer",
                opacity: webSupported ? 1 : 0.4,
                border: `1px solid ${
                  web && webSupported ? "var(--accent)" : "var(--border-strong)"
                }`,
                background:
                  web && webSupported ? "var(--accent-subtle)" : "transparent",
                color:
                  web && webSupported ? "var(--text)" : "var(--text-muted)",
                fontWeight: web && webSupported ? 550 : 450,
              }}
            >
              Web
            </button>
          )}

          {/*
            * Only worth showing with a real choice to make. One configured
            * provider needs no picker, and an empty one needs no UI at all.
            */}
          {webProviders.length > 1 && web && webSupported && (
            <select
              value={webProvider}
              disabled={busy}
              onChange={(e) => onWebProviderChange(e.target.value)}
              aria-label="Search provider"
              title="Which search service to use. They return different results, so it is worth trying both on the same question."
              style={{
                flexShrink: 0,
                padding: "7px 6px",
                borderRadius: 8,
                border: "1px solid var(--border-strong)",
                background: "var(--bg)",
                color: "var(--text-muted)",
                fontSize: 13,
                maxWidth: 110,
              }}
            >
              {webProviders.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.name}
                </option>
              ))}
            </select>
          )}

          {busy ? (
            <button
              type="button"
              onClick={onStop}
              style={{
                flexShrink: 0,
                padding: "7px 14px",
                borderRadius: 8,
                border: "1px solid var(--border-strong)",
                background: "var(--bg)",
                cursor: "pointer",
                fontSize: 13,
              }}
            >
              Stop
            </button>
          ) : (
            <button
              type="button"
              onClick={onSubmit}
              disabled={!value.trim() || disabled}
              style={{
                flexShrink: 0,
                padding: "7px 14px",
                borderRadius: 8,
                border: "none",
                background: value.trim() ? "var(--accent)" : "var(--bg-hover)",
                color: value.trim() ? "var(--accent-fg)" : "var(--text-faint)",
                cursor: value.trim() ? "pointer" : "default",
                fontWeight: 550,
                fontSize: 13,
              }}
            >
              Send
            </button>
          )}
        </div>

        <p
          style={{
            fontSize: 11.5,
            color: "var(--text-faint)",
            margin: "8px 2px 0",
            textAlign: "center",
          }}
        >
          Enter to send, Shift+Enter for a new line.{" "}
          {web && webSupported && webProviders.length > 0
            ? "With the web on, a model can cite a real page and still misread it — open the sources."
            : "Open-weight models make things up — check anything that matters."}
        </p>
      </div>
    </div>
  );
}
