"use client";

import type { ModelInfo } from "../types";

export function ModelPicker({
  models,
  value,
  onChange,
  disabled,
}: {
  models: ModelInfo[];
  value: string;
  onChange: (model: string) => void;
  disabled?: boolean;
}) {
  const selected = models.find((m) => m.id === value);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <select
        value={value}
        disabled={disabled || models.length === 0}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Model"
        style={{
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          padding: "5px 8px",
          background: "var(--bg-raised)",
          fontSize: 13,
          maxWidth: 220,
        }}
      >
        {models.length === 0 && <option>Loading…</option>}
        {models.map((model) => (
          <option key={model.id} value={model.id}>
            {model.id}
            {model.slow ? "  (slow)" : ""}
            {model.alias ? "  (alias)" : ""}
          </option>
        ))}
      </select>

      {selected?.slow && (
        <span
          title="Measured between 92 and 360 seconds for identical requests during testing."
          style={{
            fontSize: 11,
            color: "var(--warn-text)",
            background: "var(--warn-bg)",
            border: "1px solid var(--warn-border)",
            borderRadius: 4,
            padding: "1px 6px",
            whiteSpace: "nowrap",
          }}
        >
          can take minutes
        </span>
      )}
    </div>
  );
}
