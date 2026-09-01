"use client";

import { useEffect, useRef } from "react";

export function Composer({
  value,
  onChange,
  onSubmit,
  onStop,
  busy,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  busy: boolean;
  disabled: boolean;
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
          Enter to send, Shift+Enter for a new line. Open-weight models make
          things up — check anything that matters.
        </p>
      </div>
    </div>
  );
}
