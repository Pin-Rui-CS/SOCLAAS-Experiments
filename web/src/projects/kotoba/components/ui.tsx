import type { ButtonHTMLAttributes, CSSProperties } from "react";

/**
 * The few shared pieces Kotoba's screens use. Colours come from the site's
 * palette in globals.css; the three Anki count colours are added here, with
 * dark values, by `KotobaStyles`.
 */

export const JP_FONT =
  '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic UI", "Yu Gothic", "Noto Sans JP", Meiryo, sans-serif';

export function KotobaStyles() {
  return (
    <style>{`
      .kotoba {
        --k-new: var(--accent);
        --k-learn: #b45309;
        --k-due: #15803d;
        --k-wrong: var(--danger);
      }
      @media (prefers-color-scheme: dark) {
        .kotoba { --k-learn: #f0a35e; --k-due: #5fcf86; }
      }
      .kotoba button:focus-visible, .kotoba a:focus-visible,
      .kotoba input:focus-visible, .kotoba select:focus-visible, .kotoba textarea:focus-visible {
        outline: 2px solid var(--accent);
        outline-offset: 2px;
      }
      .kotoba button:disabled { opacity: 0.5; cursor: default; }
    `}</style>
  );
}

type Variant = "primary" | "dark" | "secondary" | "ghost";

const VARIANTS: Record<Variant, CSSProperties> = {
  primary: { background: "var(--accent)", color: "var(--accent-fg)", borderColor: "var(--accent)", fontWeight: 500 },
  dark: { background: "var(--text)", color: "var(--bg)", borderColor: "var(--text)", fontWeight: 500 },
  secondary: { background: "var(--bg-raised)", color: "var(--text)", borderColor: "var(--border-strong)" },
  ghost: { background: "transparent", color: "var(--text-muted)", borderColor: "transparent" },
};

export function Button({
  variant = "secondary",
  style,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type="button"
      {...props}
      style={{
        height: 36,
        padding: "0 14px",
        border: "1px solid",
        borderRadius: "var(--radius)",
        font: "inherit",
        cursor: "pointer",
        whiteSpace: "nowrap",
        ...VARIANTS[variant],
        ...style,
      }}
    />
  );
}

export const inputStyle: CSSProperties = {
  height: 36,
  padding: "0 10px",
  border: "1px solid var(--border-strong)",
  borderRadius: "var(--radius)",
  font: "inherit",
  color: "var(--text)",
  background: "var(--bg-raised)",
  minWidth: 0,
};

export const labelStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  fontSize: 13,
  color: "var(--text-muted)",
};

export const sectionTitle: CSSProperties = { margin: 0, fontSize: 15, fontWeight: 600 };

/** Anki's three numbers, faint when zero. */
export function Count({ value, color, underline }: { value: number; color: string; underline?: boolean }) {
  return (
    <span
      style={{
        color: value ? color : "var(--text-faint)",
        fontWeight: value ? 600 : 400,
        fontVariantNumeric: "tabular-nums",
        textDecoration: underline ? "underline" : undefined,
        textUnderlineOffset: 4,
      }}
    >
      {value}
    </span>
  );
}

/** Save a text file to the viewer's downloads. */
export function downloadText(filename: string, text: string, type = "application/json") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

