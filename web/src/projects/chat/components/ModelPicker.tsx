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
          maxWidth: 230,
        }}
      >
        {models.length === 0 && <option>Loading…</option>}
        {models.map((model) => (
          <option key={model.id} value={model.id}>
            {model.id}
            {model.reasons ? "  (thinks first)" : ""}
          </option>
        ))}
      </select>

      {selected?.reasons && (
        <span
          title="This model reasons before answering. The thinking appears in its own panel, and the wait varies with the question — seconds for something easy, minutes for something hard."
          style={{
            fontSize: 11,
            color: "var(--text-muted)",
            border: "1px solid var(--border)",
            borderRadius: 4,
            padding: "1px 6px",
            whiteSpace: "nowrap",
          }}
        >
          thinks before answering
        </span>
      )}
    </div>
  );
}
