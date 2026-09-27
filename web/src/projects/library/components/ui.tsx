"use client";

import type { CSSProperties, ReactNode } from "react";

/** Small presentational pieces shared across the library's views. */

export const buttonStyle = {
  padding: "4px 12px",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius)",
  background: "transparent",
  cursor: "pointer",
  fontSize: 12.5,
} as const;
export const cellStyle = { padding: "6px 8px", borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" } as const;
export const numStyle = { ...cellStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" } as const;

export function Section({ title, action, children }: { title?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section style={{ marginTop: 22 }}>
      {(title || action) && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 10 }}>
          {title && <h3 style={{ fontSize: 13.5, fontWeight: 600, margin: 0 }}>{title}</h3>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Collapsible({ label, defaultOpen = false, children }: { label: ReactNode; defaultOpen?: boolean; children: ReactNode }) {
  return (
    <details open={defaultOpen} style={{ border: "1px solid var(--border)", borderRadius: "var(--radius)", marginBottom: 8 }}>
      <summary style={{ padding: "8px 12px", cursor: "pointer", fontSize: 13, fontWeight: 500 }}>{label}</summary>
      <div style={{ padding: "4px 14px 12px", fontSize: 13.5, overflowX: "auto" }}>{children}</div>
    </details>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ fontSize: 13.5, marginBottom: 12, lineHeight: 1.55 }}>
      <div style={{ color: "var(--text-muted)", fontSize: 12, marginBottom: 2 }}>{label}</div>
      <div>{children}</div>
    </div>
  );
}

export function Tag({ tone, children }: { tone?: "warn"; children: ReactNode }) {
  return (
    <span
      style={{
        display: "inline-block",
        marginLeft: 6,
        padding: "0 7px",
        borderRadius: 10,
        fontSize: 11.5,
        lineHeight: "18px",
        border: `1px solid ${tone === "warn" ? "var(--warn-border)" : "var(--border)"}`,
        background: tone === "warn" ? "var(--warn-bg)" : "var(--bg-subtle)",
        color: tone === "warn" ? "var(--warn-text)" : "var(--text-muted)",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

export function Notice({ tone, children }: { tone?: "warn"; children: ReactNode }) {
  return (
    <div
      style={{
        margin: "12px 0",
        padding: "10px 14px",
        borderRadius: "var(--radius)",
        fontSize: 13,
        background: tone === "warn" ? "var(--warn-bg)" : "var(--bg-subtle)",
        border: `1px solid ${tone === "warn" ? "var(--warn-border)" : "var(--border)"}`,
        color: tone === "warn" ? "var(--warn-text)" : "var(--text)",
      }}
    >
      {children}
    </div>
  );
}

export function Muted({ children }: { children: ReactNode }) {
  return <span style={{ color: "var(--text-muted)" }}>{children}</span>;
}

export function Faint({ children, style, as = "div" }: { children: ReactNode; style?: CSSProperties; as?: "div" | "span" }) {
  const Element = as;
  return <Element style={{ color: "var(--text-faint)", fontSize: 12.5, ...style }}>{children}</Element>;
}

/** A run's colour chip, matching its curve. */
export function RunDot({ color }: { color: string | null }) {
  if (!color) return null;
  return (
    <span
      aria-hidden
      style={{ display: "inline-block", width: 9, height: 9, borderRadius: 2, marginRight: 6, background: color, flexShrink: 0 }}
    />
  );
}
