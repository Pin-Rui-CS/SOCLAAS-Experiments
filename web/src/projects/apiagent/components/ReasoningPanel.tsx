"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The model's thinking, shown rather than discarded.
 *
 * Reasoning models put their argument here and only the conclusion in the
 * answer, so this is usually the bulk of what was generated. It is expanded
 * while streaming — on a model that can think for minutes before saying
 * anything, this is the only sign that work is happening — and collapses once
 * the answer starts.
 *
 * It is not persisted; on reload this panel is gone. That is deliberate.
 */
export function ReasoningPanel({
  text,
  streaming,
}: {
  text: string;
  streaming: boolean;
}) {
  const [open, setOpen] = useState(streaming);
  const [userToggled, setUserToggled] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Collapse when the answer arrives, unless the reader has taken control.
  useEffect(() => {
    if (!userToggled) setOpen(streaming);
  }, [streaming, userToggled]);

  // Follow the text while it streams.
  useEffect(() => {
    if (open && streaming && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [text, open, streaming]);

  if (!text.trim()) return null;

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
        onClick={() => {
          setUserToggled(true);
          setOpen((v) => !v);
        }}
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
        <span style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform 120ms" }}>
          ▶
        </span>
        <span style={{ fontWeight: 550 }}>
          {streaming ? "Thinking…" : "Reasoning"}
        </span>
        <span style={{ color: "var(--text-faint)" }}>
          {text.length.toLocaleString()} chars
        </span>
      </button>

      {open && (
        <div
          ref={bodyRef}
          style={{
            maxHeight: 260,
            overflowY: "auto",
            padding: "0 12px 10px",
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            lineHeight: 1.6,
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
