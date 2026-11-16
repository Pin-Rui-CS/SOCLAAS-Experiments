"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  compactChars,
  type NodeShape,
  type NodeStatus,
  type PipelineGraph,
  type PipelineNode,
  type SectionPacket,
  type SelectionTarget,
} from "../pipeline";

type ConnectorPath = {
  key: string;
  from: string;
  to: string;
  d: string;
};

const SHAPE_GLYPH: Record<NodeShape, string> = {
  rect: "▭",
  ellipse: "◯",
  diamond: "◆",
};

/**
 * Excalidraw-faithful, low-noise interactive DAG of the bot's 5-stage pipeline.
 * Cards show only shape + title + status dot + 1–2 compact metric pills; clicking
 * any node or `◆` section packet opens the slide-over Inspector Drawer.
 */
export function PipelineCanvas({
  graph,
  selected,
  onSelect,
}: {
  graph: PipelineGraph;
  selected: SelectionTarget | null;
  onSelect: (target: SelectionTarget) => void;
}) {
  const [showBlueprint, setShowBlueprint] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [paths, setPaths] = useState<ConnectorPath[]>([]);

  const selectedNodeId =
    selected?.kind === "node"
      ? selected.nodeId
      : selected?.kind === "run"
        ? `run:${selected.runIndex}`
        : selected?.kind === "section"
          ? graph.packets.find((p) => p.id === selected.packetId)?.sourceNodeId ?? null
          : null;

  const focusId = hoveredId ?? selectedNodeId;

  // Connected neighborhood when hovering or inspecting a node
  const focusedSet = useMemo(() => {
    if (!focusId) return null;
    const node = graph.nodeMap.get(focusId);
    if (!node) return null;
    return new Set<string>([focusId, ...node.upstream, ...node.downstream]);
  }, [focusId, graph.nodeMap]);

  const isVisible = useCallback(
    (n: PipelineNode | undefined) => {
      if (!n) return false;
      if (showBlueprint) return true;
      if (n.id === "question-info" || n.id === "evidence-plan" || n.id === "artifact-check-v1" || n.id === "aggregation") {
        return true;
      }
      return n.active;
    },
    [showBlueprint],
  );

  const visibleNodes = useMemo(
    () => graph.nodes.filter((n) => isVisible(n)),
    [graph.nodes, isVisible],
  );

  // Measure rendered node positions inside containerRef to draw crisp SVG bezier edges
  const recomputePaths = useCallback(() => {
    const root = containerRef.current;
    if (!root) return;
    const rootRect = root.getBoundingClientRect();
    if (rootRect.width === 0) return;

    const rects = new Map<string, { left: number; right: number; top: number; bottom: number; cx: number; cy: number }>();
    const els = root.querySelectorAll<HTMLElement>("[data-node-id]");
    els.forEach((el) => {
      const id = el.dataset.nodeId;
      if (!id) return;
      const r = el.getBoundingClientRect();
      const left = r.left - rootRect.left;
      const top = r.top - rootRect.top;
      rects.set(id, {
        left,
        right: left + r.width,
        top,
        bottom: top + r.height,
        cx: left + r.width / 2,
        cy: top + r.height / 2,
      });
    });

    const next: ConnectorPath[] = [];
    for (const node of visibleNodes) {
      const a = rects.get(node.id);
      if (!a) continue;
      for (const targetId of node.downstream) {
        const b = rects.get(targetId);
        if (!b) continue;
        // Vertical flow (top-to-bottom) vs same-row horizontal flow
        const dy = b.top - a.bottom;
        let d: string;
        if (Math.abs(a.cy - b.cy) < 22) {
          const ltr = b.cx >= a.cx;
          const x1 = ltr ? a.right : a.left;
          const x2 = ltr ? b.left : b.right;
          const mx = (x1 + x2) / 2;
          d = `M ${x1.toFixed(1)} ${a.cy.toFixed(1)} C ${mx.toFixed(1)} ${a.cy.toFixed(1)}, ${mx.toFixed(1)} ${b.cy.toFixed(1)}, ${x2.toFixed(1)} ${b.cy.toFixed(1)}`;
        } else {
          const y1 = dy >= -10 ? a.bottom : a.top;
          const y2 = dy >= -10 ? b.top : b.bottom;
          const span = Math.max(18, Math.abs(y2 - y1) * 0.5);
          const c1y = dy >= -10 ? y1 + span : y1 - span;
          const c2y = dy >= -10 ? y2 - span : y2 + span;
          d = `M ${a.cx.toFixed(1)} ${y1.toFixed(1)} C ${a.cx.toFixed(1)} ${c1y.toFixed(1)}, ${b.cx.toFixed(1)} ${c2y.toFixed(1)}, ${b.cx.toFixed(1)} ${y2.toFixed(1)}`;
        }
        next.push({ key: `${node.id}->${targetId}`, from: node.id, to: targetId, d });
      }
    }
    setPaths(next);
  }, [visibleNodes]);

  useLayoutEffect(() => {
    recomputePaths();
  }, [recomputePaths]);

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const observer = new ResizeObserver(() => recomputePaths());
    observer.observe(root);
    return () => observer.disconnect();
  }, [recomputePaths]);

  const get = (id: string) => {
    const n = graph.nodeMap.get(id);
    return isVisible(n) ? n : undefined;
  };

  // Stage buckets
  const qNode = get("question-info");
  const resNode = get("resolution-source");
  const expNode = get("source-explorer");
  const askNode = get("asknews");
  const apiNode = get("public-data");
  const planNode = get("evidence-plan");

  const researchNodes = visibleNodes.filter((n) => n.stage === "research");
  const ac1Node = get("artifact-check-v1");
  const retryNode = get("focus-retry");
  const ac2Node = get("artifact-check-v2");

  const briefNode = get("brief-compiler");
  const rawNode = get("raw-view");
  const runNodes = visibleNodes.filter((n) => n.runIndex != null);
  const briefRuns = runNodes.filter((n) => !graph.rawRunIndices.has(n.runIndex!));
  const rawRuns = runNodes.filter((n) => graph.rawRunIndices.has(n.runIndex!));
  const aggNode = get("aggregation");

  const visiblePackets = showBlueprint ? graph.packets : graph.packets.filter((p) => p.present);
  const hiddenCount = graph.nodes.length - visibleNodes.length;

  return (
    <div style={{ marginTop: 6 }}>
      {/* Slim Legend & Blueprint Toggle */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          marginBottom: 8,
          fontSize: 11.5,
          color: "var(--text-faint)",
        }}
      >
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 12px" }}>
          <span>▭ Subsystem</span>
          <span>◯ LLM / API</span>
          <span>◆ Section Packet</span>
          <span style={{ color: "var(--text-muted)" }}>· Click any node to inspect</span>
        </div>

        <label
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            cursor: "pointer",
            color: "var(--text-muted)",
            userSelect: "none",
          }}
        >
          <input
            type="checkbox"
            checked={showBlueprint}
            onChange={(e) => setShowBlueprint(e.target.checked)}
          />
          Full blueprint{hiddenCount > 0 && !showBlueprint ? ` (+${hiddenCount} inactive)` : ""}
        </label>
      </div>

      {/* Main DAG Surface */}
      <div ref={containerRef} className="lib-dag-surface">
        {/* Dynamic SVG Connector Layer */}
        <svg
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            pointerEvents: "none",
            overflow: "visible",
          }}
        >
          {paths.map((p) => {
            const highlighted =
              focusId != null && (p.from === focusId || p.to === focusId);
            const dimmed = focusId != null && !highlighted;
            return (
              <path
                key={p.key}
                d={p.d}
                fill="none"
                stroke={highlighted ? "var(--accent)" : "var(--border-strong)"}
                strokeWidth={highlighted ? 1.75 : 1.15}
                strokeOpacity={dimmed ? 0.22 : highlighted ? 0.95 : 0.65}
                style={{ transition: "stroke-opacity 140ms ease, stroke 140ms ease" }}
              />
            );
          })}
        </svg>

        {/* INPUT: QUESTION */}
        {qNode && (
          <div style={centerRow}>
            <NodeCard
              node={qNode}
              selected={selectedNodeId === qNode.id}
              dimmed={focusedSet != null && !focusedSet.has(qNode.id)}
              onHover={setHoveredId}
              onClick={() => onSelect({ kind: "question" })}
            />
          </div>
        )}

        {/* STAGE 1: INITIAL GROUNDING */}
        {(resNode || expNode || askNode || apiNode) && (
          <StageBand label="1 · Grounding">
            <div className="lib-dag-cols-3">
              {(resNode || expNode) && (
                <div style={{ display: "grid", gap: 12, alignContent: "start" }}>
                  {resNode && (
                    <NodeCard
                      node={resNode}
                      selected={selectedNodeId === resNode.id}
                      dimmed={focusedSet != null && !focusedSet.has(resNode.id)}
                      onHover={setHoveredId}
                      onClick={() => onSelect({ kind: "node", nodeId: resNode.id })}
                    />
                  )}
                  {expNode && (
                    <NodeCard
                      node={expNode}
                      selected={selectedNodeId === expNode.id}
                      dimmed={focusedSet != null && !focusedSet.has(expNode.id)}
                      onHover={setHoveredId}
                      onClick={() => onSelect({ kind: "node", nodeId: expNode.id })}
                    />
                  )}
                </div>
              )}
              {askNode && (
                <div>
                  <NodeCard
                    node={askNode}
                    selected={selectedNodeId === askNode.id}
                    dimmed={focusedSet != null && !focusedSet.has(askNode.id)}
                    onHover={setHoveredId}
                    onClick={() => onSelect({ kind: "node", nodeId: askNode.id })}
                  />
                </div>
              )}
              {apiNode && (
                <div>
                  <NodeCard
                    node={apiNode}
                    selected={selectedNodeId === apiNode.id}
                    dimmed={focusedSet != null && !focusedSet.has(apiNode.id)}
                    onHover={setHoveredId}
                    onClick={() => onSelect({ kind: "node", nodeId: apiNode.id })}
                  />
                </div>
              )}
            </div>
          </StageBand>
        )}

        {/* STAGE 2: PLANNING HUB */}
        {planNode && (
          <StageBand label="2 · Planning">
            <div style={centerRow}>
              <div style={{ width: "min(300px, 100%)" }}>
                <NodeCard
                  node={planNode}
                  selected={selectedNodeId === planNode.id}
                  dimmed={focusedSet != null && !focusedSet.has(planNode.id)}
                  onHover={setHoveredId}
                  onClick={() => onSelect({ kind: "node", nodeId: planNode.id })}
                />
              </div>
            </div>
          </StageBand>
        )}

        {/* STAGE 3: PLAN-DRIVEN DEEP RESEARCH */}
        {researchNodes.length > 0 && (
          <StageBand label="3 · Deep Research">
            <div
              style={{
                display: "grid",
                gridTemplateColumns: `repeat(auto-fit, minmax(200px, 1fr))`,
                gap: 12,
                alignItems: "start",
              }}
            >
              {researchNodes.map((node) => (
                <NodeCard
                  key={node.id}
                  node={node}
                  selected={selectedNodeId === node.id}
                  dimmed={focusedSet != null && !focusedSet.has(node.id)}
                  onHover={setHoveredId}
                  onClick={() => onSelect({ kind: "node", nodeId: node.id })}
                />
              ))}
            </div>
          </StageBand>
        )}

        {/* STAGE 4: SECTION LIST & ARTIFACT CHECK LOOP */}
        <StageBand
          label="4 · Section List & Verification"
          rightMeta={graph.totalSectionChars > 0 ? `${compactChars(graph.totalSectionChars)} collected` : undefined}
        >
          {visiblePackets.length > 0 && (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 6,
                padding: "8px 10px",
                marginBottom: 14,
                borderRadius: 8,
                border: "1px dashed var(--border-strong)",
                background: "var(--bg)",
              }}
              aria-label="Collected Section List packets"
            >
              {visiblePackets.map((pkt) => (
                <PacketChip
                  key={pkt.id}
                  packet={pkt}
                  active={selected?.kind === "section" && selected.packetId === pkt.id}
                  onHover={(hover) => setHoveredId(hover ? pkt.sourceNodeId : null)}
                  onClick={() => onSelect({ kind: "section", packetId: pkt.id })}
                />
              ))}
            </div>
          )}

          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              justifyContent: "center",
              alignItems: "center",
              gap: 14,
            }}
          >
            {ac1Node && (
              <div style={{ width: "min(250px, 100%)" }}>
                <NodeCard
                  node={ac1Node}
                  selected={selectedNodeId === ac1Node.id}
                  dimmed={focusedSet != null && !focusedSet.has(ac1Node.id)}
                  onHover={setHoveredId}
                  onClick={() => onSelect({ kind: "node", nodeId: ac1Node.id })}
                />
              </div>
            )}
            {retryNode && (
              <div style={{ width: "min(230px, 100%)" }}>
                <NodeCard
                  node={retryNode}
                  selected={selectedNodeId === retryNode.id}
                  dimmed={focusedSet != null && !focusedSet.has(retryNode.id)}
                  onHover={setHoveredId}
                  onClick={() => onSelect({ kind: "node", nodeId: retryNode.id })}
                />
              </div>
            )}
            {ac2Node && (
              <div style={{ width: "min(250px, 100%)" }}>
                <NodeCard
                  node={ac2Node}
                  selected={selectedNodeId === ac2Node.id}
                  dimmed={focusedSet != null && !focusedSet.has(ac2Node.id)}
                  onHover={setHoveredId}
                  onClick={() => onSelect({ kind: "node", nodeId: ac2Node.id })}
                />
              </div>
            )}
          </div>
        </StageBand>

        {/* STAGE 5: DUAL CONTEXT SYNTHESIS → ENSEMBLE → FINAL FORECAST */}
        <StageBand label="5 · Synthesis & Ensemble">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: rawNode ? "repeat(auto-fit, minmax(260px, 1fr))" : "1fr",
              gap: 16,
              alignItems: "start",
            }}
          >
            {/* Path A: Compiled Brief → Brief Forecasters */}
            <div style={{ display: "grid", gap: 14 }}>
              {briefNode && (
                <div style={{ maxWidth: 340, margin: "0 auto", width: "100%" }}>
                  <NodeCard
                    node={briefNode}
                    selected={selectedNodeId === briefNode.id}
                    dimmed={focusedSet != null && !focusedSet.has(briefNode.id)}
                    onHover={setHoveredId}
                    onClick={() => onSelect({ kind: "node", nodeId: briefNode.id })}
                  />
                </div>
              )}
              {briefRuns.length > 0 && (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(175px, 1fr))",
                    gap: 8,
                  }}
                >
                  {briefRuns.map((rn) => (
                    <NodeCard
                      key={rn.id}
                      node={rn}
                      selected={selectedNodeId === rn.id}
                      dimmed={focusedSet != null && !focusedSet.has(rn.id)}
                      onHover={setHoveredId}
                      onClick={() => onSelect({ kind: "run", runIndex: rn.runIndex! })}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Path B: Raw Uncompiled View → Raw Forecaster */}
            {rawNode && (
              <div style={{ display: "grid", gap: 14 }}>
                <div style={{ maxWidth: 340, margin: "0 auto", width: "100%" }}>
                  <NodeCard
                    node={rawNode}
                    selected={selectedNodeId === rawNode.id}
                    dimmed={focusedSet != null && !focusedSet.has(rawNode.id)}
                    onHover={setHoveredId}
                    onClick={() => onSelect({ kind: "node", nodeId: rawNode.id })}
                  />
                </div>
                {rawRuns.length > 0 && (
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(175px, 1fr))",
                      gap: 8,
                    }}
                  >
                    {rawRuns.map((rn) => (
                      <NodeCard
                        key={rn.id}
                        node={rn}
                        selected={selectedNodeId === rn.id}
                        dimmed={focusedSet != null && !focusedSet.has(rn.id)}
                        onHover={setHoveredId}
                        onClick={() => onSelect({ kind: "run", runIndex: rn.runIndex! })}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {aggNode && (
            <div style={{ ...centerRow, marginTop: 18 }}>
              <div style={{ width: "min(290px, 100%)" }}>
                <NodeCard
                  node={aggNode}
                  selected={selectedNodeId === aggNode.id}
                  dimmed={focusedSet != null && !focusedSet.has(aggNode.id)}
                  onHover={setHoveredId}
                  onClick={() => onSelect({ kind: "node", nodeId: aggNode.id })}
                />
              </div>
            </div>
          )}
        </StageBand>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------- stage & cards */

function StageBand({
  label,
  rightMeta,
  children,
}: {
  label: string;
  rightMeta?: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ position: "relative", zIndex: 1, marginTop: 18 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 8,
        }}
      >
        <span
          style={{
            fontSize: 10.5,
            fontWeight: 650,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: "var(--text-faint)",
            background: "var(--bg-subtle)",
            padding: "1px 7px",
            borderRadius: 4,
            border: "1px solid var(--border)",
          }}
        >
          {label}
        </span>
        {rightMeta && (
          <span style={{ fontSize: 11, color: "var(--text-faint)", fontFamily: "var(--font-mono)" }}>
            {rightMeta}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

function NodeCard({
  node,
  selected,
  dimmed,
  onHover,
  onClick,
}: {
  node: PipelineNode;
  selected: boolean;
  dimmed: boolean;
  onHover: (id: string | null) => void;
  onClick: () => void;
}) {
  const skipped = !node.active || node.status === "skipped";
  const radius = node.shape === "ellipse" ? 18 : 8;
  const cutsCount = node.lineageNodes.reduce((n, ln) => n + ln.cuts.length, 0);

  return (
    <button
      type="button"
      data-node-id={node.id}
      onClick={onClick}
      onMouseEnter={() => onHover(node.id)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(node.id)}
      onBlur={() => onHover(null)}
      title={node.roleSummary}
      className="lib-dag-node"
      style={{
        position: "relative",
        zIndex: 2,
        width: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        padding: "8px 11px",
        borderRadius: radius,
        border: selected
          ? "1.5px solid var(--accent)"
          : skipped
            ? "1px dashed var(--border-strong)"
            : "1px solid var(--border)",
        background: selected ? "var(--accent-subtle)" : "var(--bg-raised)",
        boxShadow: selected ? "0 0 0 2px var(--accent-subtle)" : "0 1px 2px rgba(0,0,0,0.04)",
        cursor: "pointer",
        textAlign: "left",
        opacity: dimmed ? 0.38 : skipped ? 0.62 : 1,
        transition: "opacity 140ms ease, border-color 140ms ease, transform 120ms ease",
      }}
    >
      <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
        <NodeStatusDot status={node.status} />
        <span aria-hidden style={{ fontSize: 10.5, color: "var(--text-faint)", flexShrink: 0 }}>
          {SHAPE_GLYPH[node.shape]}
        </span>
        <span
          style={{
            fontSize: 12.5,
            fontWeight: 560,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {node.title}
        </span>
        {node.badge && (
          <span
            style={{
              fontSize: 10,
              padding: "0 5px",
              lineHeight: "15px",
              borderRadius: 999,
              background: "var(--bg-subtle)",
              border: "1px solid var(--border)",
              color: "var(--text-muted)",
              flexShrink: 0,
            }}
          >
            {node.badge}
          </span>
        )}
      </span>

      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
        {cutsCount > 0 && (
          <span
            title={`${cutsCount} truncation cut(s) recorded`}
            style={{
              fontSize: 10.5,
              color: "var(--st-warn)",
              fontWeight: 600,
            }}
          >
            ✂
          </span>
        )}
        {node.metrics.map((m, idx) => (
          <span
            key={idx}
            style={{
              fontSize: 11,
              fontFamily: "var(--font-mono)",
              fontVariantNumeric: "tabular-nums",
              color: "var(--text-muted)",
              background: "var(--bg-subtle)",
              padding: "1px 6px",
              borderRadius: 5,
              whiteSpace: "nowrap",
            }}
          >
            {m}
          </span>
        ))}
      </span>
    </button>
  );
}

function PacketChip({
  packet,
  active,
  onHover,
  onClick,
}: {
  packet: SectionPacket;
  active: boolean;
  onHover: (hover: boolean) => void;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      className="lib-hover-surface"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "3px 8px",
        borderRadius: 6,
        border: active
          ? "1px solid var(--accent)"
          : packet.present
            ? "1px solid var(--border)"
            : "1px dashed var(--border)",
        background: active ? "var(--accent-subtle)" : "var(--bg-raised)",
        opacity: packet.present ? 1 : 0.5,
        cursor: "pointer",
        fontSize: 11.5,
      }}
    >
      <span style={{ color: packet.present ? "var(--accent)" : "var(--text-faint)", fontSize: 10 }}>◆</span>
      {packet.slotNumber != null && (
        <span style={{ color: "var(--text-faint)", fontSize: 10.5, fontVariantNumeric: "tabular-nums" }}>
          #{packet.slotNumber}
        </span>
      )}
      <span style={{ fontWeight: 520 }}>{packet.label}</span>
      {packet.chars != null && (
        <span
          style={{
            fontSize: 10.5,
            fontFamily: "var(--font-mono)",
            fontVariantNumeric: "tabular-nums",
            color: "var(--text-muted)",
          }}
        >
          {compactChars(packet.chars)}
        </span>
      )}
    </button>
  );
}

function NodeStatusDot({ status }: { status: NodeStatus }) {
  const color: Record<NodeStatus, string> = {
    pass: "var(--st-pass)",
    warn: "var(--st-warn)",
    fail: "var(--st-fail)",
    skipped: "var(--st-skipped)",
  };
  return (
    <span
      aria-hidden
      style={{
        width: 7,
        height: 7,
        borderRadius: "50%",
        flexShrink: 0,
        background: status === "skipped" ? "transparent" : color[status],
        border: status === "skipped" ? `1.5px dashed ${color[status]}` : "none",
      }}
    />
  );
}

const centerRow = {
  position: "relative",
  zIndex: 1,
  display: "flex",
  justifyContent: "center",
  width: "min(270px, 100%)",
  margin: "0 auto",
} as const;
