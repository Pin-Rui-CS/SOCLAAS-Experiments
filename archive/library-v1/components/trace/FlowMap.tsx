"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { LineageNode } from "../../types";
import { StatusDot, chars, indexLineage, shortLabel, statusVar, worstStatus } from "./shared";

/**
 * The flow map (LINEAGE.md §6.1): columns are `lanes`, rows are `layer`.
 * Nodes sharing a `group` collapse into one box; one arrow per pair of boxes
 * with an edge between their members, labelled with the characters that
 * flowed, red and dashed where any underlying edge cut text.
 *
 * Layout is CSS grid; arrows are an SVG layer behind the boxes, drawn from the
 * boxes' measured positions so they follow whatever the grid did.
 */

type Group = { key: string; lane: string | null; layer: number; nodes: LineageNode[] };
type Box = { x: number; y: number; w: number; h: number };

const SPAN = "*";
const MEMBER_LIMIT = 6;
const COLUMN_MIN = 160;

export function FlowMap({
  ix,
  selected,
  onSelect,
}: {
  ix: ReturnType<typeof indexLineage>;
  selected: string | null;
  onSelect: (nodeId: string) => void;
}) {
  const { doc } = ix;

  const { groups, groupOf, columns, layers } = useMemo(() => {
    const groups = new Map<string, Group>();
    for (const n of doc.nodes) {
      const g = groups.get(n.group) ?? { key: n.group, lane: n.lane, layer: n.layer, nodes: [] };
      g.nodes.push(n);
      groups.set(n.group, g);
    }
    for (const g of groups.values()) g.nodes.sort((a, b) => (a.seq ?? -1) - (b.seq ?? -1));
    const groupOf = new Map(doc.nodes.map((n) => [n.id, n.group]));
    // Lanes the document lists, in its order, then any a node uses that it forgot to list.
    const extra = [...new Set(doc.nodes.map((n) => n.lane).filter((l): l is string => !!l && l !== SPAN && !doc.lanes.includes(l)))];
    const columns = [...doc.lanes, ...extra];
    const layers = [...new Set(doc.nodes.map((n) => n.layer))].sort((a, b) => a - b);
    return { groups, groupOf, columns, layers };
  }, [doc]);

  // Box-to-box arrows, merged from node edges.
  const arrows = useMemo(() => {
    const merged = new Map<string, { from: string; to: string; chars: number; known: boolean; cut: boolean; reasons: Set<string> }>();
    for (const e of doc.edges) {
      const from = groupOf.get(e.from);
      const to = groupOf.get(e.to);
      if (!from || !to || from === to) continue;
      const key = `${from}→${to}`;
      const a = merged.get(key) ?? { from, to, chars: 0, known: false, cut: false, reasons: new Set<string>() };
      if (typeof e.chars === "number") {
        a.chars += e.chars;
        a.known = true;
      }
      if (e.cut) {
        a.cut = true;
        for (const c of ix.node.get(e.from)?.cuts ?? []) a.reasons.add(c.reason);
      }
      merged.set(key, a);
    }
    return [...merged.values()];
  }, [doc.edges, groupOf, ix.node]);

  // Measure every box after layout, and again whenever the map resizes.
  const container = useRef<HTMLDivElement>(null);
  const boxRefs = useRef(new Map<string, HTMLElement>());
  const [boxes, setBoxes] = useState<Map<string, Box>>(new Map());
  const [size, setSize] = useState({ w: 0, h: 0 });

  useLayoutEffect(() => {
    const el = container.current;
    if (!el) return;
    const measure = () => {
      const origin = el.getBoundingClientRect();
      const next = new Map<string, Box>();
      for (const [key, box] of boxRefs.current) {
        const r = box.getBoundingClientRect();
        next.set(key, { x: r.left - origin.left, y: r.top - origin.top, w: r.width, h: r.height });
      }
      setBoxes(next);
      setSize({ w: el.scrollWidth, h: el.scrollHeight });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [groups]);

  const selectedGroup = selected ? groupOf.get(selected) ?? null : null;
  const related = useMemo(() => {
    if (!selected) return new Set<string>();
    const n = ix.node.get(selected);
    return new Set([...(n?.parents ?? []), ...(n?.children ?? [])].map((id) => groupOf.get(id)).filter(Boolean) as string[]);
  }, [selected, ix.node, groupOf]);

  const renderBox = (g: Group) => (
    <GroupBox
      key={g.key}
      group={g}
      spanning={g.lane === SPAN || g.lane === null}
      selected={selected}
      emphasis={g.key === selectedGroup ? "selected" : related.has(g.key) ? "related" : null}
      onSelect={onSelect}
      boxRef={(el) => {
        if (el) boxRefs.current.set(g.key, el);
        else boxRefs.current.delete(g.key);
      }}
    />
  );

  return (
    <div style={{ overflowX: "auto", paddingBottom: 6 }}>
      <div ref={container} style={{ position: "relative", minWidth: columns.length * COLUMN_MIN }}>
        <svg
          width={size.w}
          height={size.h}
          style={{ position: "absolute", inset: 0, zIndex: 0, overflow: "visible" }}
          aria-hidden
        >
          <defs>
            <marker id="flow-head" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L8,4 L0,8 z" fill="var(--text-faint)" />
            </marker>
            <marker id="flow-head-cut" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L8,4 L0,8 z" fill="var(--st-fail)" />
            </marker>
          </defs>
          {arrows.map((a) => {
            const s = boxes.get(a.from);
            const t = boxes.get(a.to);
            if (!s || !t) return null;
            // Land each arrow inside the other box's span, so drops into a wide merge step stay vertical.
            const clamp = (v: number, b: Box) => Math.min(b.x + b.w - 14, Math.max(b.x + 14, v));
            const sx = clamp(t.x + t.w / 2, s);
            const tx = clamp(sx, t);
            const sy = s.y + s.h;
            const ty = t.y - 2;
            const dy = Math.max(24, (ty - sy) / 2);
            const d = `M${sx},${sy} C${sx},${sy + dy} ${tx},${ty - dy} ${tx},${ty}`;
            const touches = selectedGroup && (a.from === selectedGroup || a.to === selectedGroup);
            const faded = selectedGroup && !touches;
            const color = a.cut ? "var(--st-fail)" : touches ? "var(--accent)" : "var(--border-strong)";
            const label = a.known && a.chars > 0 ? chars(a.chars) : null;
            // Put the label at the arrow's narrow end — just under a column box, or just above
            // one — so labels converging on a wide merge step do not pile on top of each other.
            const atSource = s.w <= t.w;
            const mx = atSource ? sx : tx;
            const my = atSource ? sy + 13 : ty - 7;
            return (
              <g key={`${a.from}→${a.to}`} opacity={faded ? 0.25 : 1} style={{ pointerEvents: "stroke" }}>
                <title>
                  {`${a.from.split("|").pop()} → ${a.to.split("|").pop()}${label ? ` · ${label} chars` : ""}${a.cut ? ` · cut: ${[...a.reasons].join("; ") || "text cut or compressed"}` : ""}`}
                </title>
                <path d={d} fill="none" stroke="transparent" strokeWidth={10} />
                <path
                  d={d}
                  fill="none"
                  stroke={color}
                  strokeWidth={touches ? 2 : 1.4}
                  strokeDasharray={a.cut ? "5 4" : undefined}
                  markerEnd={a.cut ? "url(#flow-head-cut)" : "url(#flow-head)"}
                />
                {label && (
                  <text
                    x={mx + 4}
                    y={my}
                    fontSize={10.5}
                    fill={a.cut ? "var(--st-fail)" : "var(--text-muted)"}
                    stroke="var(--bg)"
                    strokeWidth={3}
                    paintOrder="stroke"
                  >
                    {label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>

        {/* Column headers */}
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${columns.length}, minmax(${COLUMN_MIN - 14}px, 1fr))`, gap: "0 14px", marginBottom: 10, position: "relative", zIndex: 1 }}>
          {columns.map((lane) => (
            <div key={lane} title={lane} style={{ fontSize: 11.5, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", borderBottom: "1px solid var(--border)", paddingBottom: 4 }}>
              {lane}
            </div>
          ))}
        </div>

        {layers.map((layer) => {
          const inLayer = [...groups.values()].filter((g) => g.layer === layer);
          const spanning = inLayer.filter((g) => g.lane === SPAN || g.lane === null);
          const laned = inLayer.filter((g) => g.lane !== SPAN && g.lane !== null);
          return (
            <div key={layer} style={{ position: "relative", zIndex: 1, marginBottom: 30 }}>
              {spanning.length > 0 && (
                <div style={{ display: "flex", gap: 14, marginBottom: laned.length ? 12 : 0 }}>
                  {spanning.map(renderBox)}
                </div>
              )}
              {laned.length > 0 && (
                <div style={{ display: "grid", gridTemplateColumns: `repeat(${columns.length}, minmax(${COLUMN_MIN - 14}px, 1fr))`, gap: "0 14px", alignItems: "start" }}>
                  {columns.map((lane) => {
                    const here = laned.filter((g) => g.lane === lane);
                    return (
                      <div key={lane} style={{ display: "grid", gap: 10, minWidth: 0 }}>
                        {here.map(renderBox)}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function GroupBox({
  group,
  spanning,
  selected,
  emphasis,
  onSelect,
  boxRef,
}: {
  group: Group;
  spanning: boolean;
  selected: string | null;
  emphasis: "selected" | "related" | null;
  onSelect: (id: string) => void;
  boxRef: (el: HTMLElement | null) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const nodes = group.nodes;
  const first = nodes[0];
  const worst = worstStatus(nodes);
  const allUnused = nodes.every((n) => n.status === "unused");
  const title = nodes.length > 1 ? `${nodes.length} × ${first.stage}` : first.stage;
  const pass = !spanning && first.pass && first.pass !== "main pass" ? first.pass : null;
  const shown = expanded ? nodes : nodes.slice(0, MEMBER_LIMIT);
  const isInput = first.kind === "input";

  if (isInput) {
    // The question input: a thin bar across the top.
    return (
      <button
        ref={boxRef as (el: HTMLButtonElement | null) => void}
        type="button"
        onClick={() => onSelect(first.id)}
        style={{
          flex: 1,
          padding: "5px 12px",
          border: "1px solid var(--border)",
          borderRadius: 8,
          background: emphasis === "selected" ? "var(--accent-subtle)" : "var(--bg-subtle)",
          fontSize: 12,
          color: "var(--text-muted)",
          textAlign: "left",
          cursor: "pointer",
        }}
      >
        Input · {first.label ?? "question"}
      </button>
    );
  }

  return (
    <div
      ref={boxRef as (el: HTMLDivElement | null) => void}
      style={{
        flex: spanning ? 1 : undefined,
        minWidth: 0,
        background: "var(--bg-raised)",
        border: `1px ${allUnused ? "dashed" : "solid"} ${emphasis === "selected" ? "var(--accent)" : emphasis === "related" ? "var(--border-strong)" : "var(--border)"}`,
        borderTop: `3px ${allUnused ? "dashed" : "solid"} ${statusVar(worst)}`,
        borderRadius: 8,
        boxShadow: emphasis === "selected" ? "0 0 0 2px var(--accent-subtle)" : "none",
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        onClick={() => (nodes.length === 1 ? onSelect(first.id) : setExpanded(!expanded))}
        title={nodes.length === 1 ? "Open this step" : undefined}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 9px 4px",
          border: "none",
          background: "transparent",
          cursor: "pointer",
          textAlign: "left",
          fontSize: 12.5,
          fontWeight: 600,
          minWidth: 0,
        }}
      >
        <StatusDot status={worst} />
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</span>
        {pass && <span style={{ marginLeft: "auto", fontSize: 10.5, fontWeight: 500, color: "var(--text-faint)", whiteSpace: "nowrap" }}>{pass}</span>}
      </button>
      <div style={{ padding: "0 4px 5px" }}>
        {shown.map((n) => (
          <button
            key={n.id}
            type="button"
            onClick={() => onSelect(n.id)}
            title={`${n.label ?? n.stage}${n.error ? ` — ${n.error}` : ""}`}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "2px 5px",
              border: "none",
              borderRadius: 5,
              background: n.id === selected ? "var(--accent-subtle)" : "transparent",
              cursor: "pointer",
              textAlign: "left",
              fontSize: 11.5,
              color: "var(--text-muted)",
              minWidth: 0,
            }}
          >
            <StatusDot status={n.status} size={6} />
            <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textDecoration: n.status === "unused" ? "line-through" : "none" }}>
              {shortLabel(n.label ?? n.stage, spanning ? 70 : 28)}
            </span>
            {n.cuts.length > 0 && <span title={n.cuts.map((c) => c.reason).join("; ")} style={{ color: "var(--st-fail)" }}>✂</span>}
            <span style={{ fontVariantNumeric: "tabular-nums", color: "var(--text-faint)" }}>{n.output ? chars(n.output.chars) : ""}</span>
          </button>
        ))}
        {nodes.length > MEMBER_LIMIT && (
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            style={{ border: "none", background: "transparent", color: "var(--accent)", cursor: "pointer", fontSize: 11.5, padding: "2px 5px" }}
          >
            {expanded ? "Show fewer" : `+${nodes.length - MEMBER_LIMIT} more`}
          </button>
        )}
      </div>
    </div>
  );
}
