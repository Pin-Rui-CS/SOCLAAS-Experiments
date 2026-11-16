"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { fileSections, fileUrl, getJson } from "../api";
import {
  compactChars,
  compactSeconds,
  shortModelName,
  type NodeStatus,
  type PipelineGraph,
  type PipelineNode,
  type SectionPacket,
  type SelectionTarget,
  type SystemSummary,
} from "../pipeline";
import type {
  ArtifactCheck,
  FileKey,
  ForecastDetail,
  LineageCall,
  LineageNode,
  LiveQuestion,
  LlmCall,
  RunEntry,
} from "../types";
import { SeriesTable, runColor } from "./DistributionCharts";
import { downloadHref } from "./DownloadMenu";
import { Markdown } from "./Markdown";
import { ValueView, formatDate, formatNumber } from "./Value";
import { Collapsible, Faint, Field, Muted, Notice, RunDot, Tag, buttonStyle, cellStyle, numStyle } from "./ui";

const STEP_PREVIEW_LIMIT = 45_000;

/**
 * On-demand slide-over Contextual Inspector.
 * Occupies zero permanent width on the main workspace; opens smoothly from the
 * right when clicking any pipeline node, `◆` section packet, forecaster row,
 * centralised system pill, cost tile, or question header.
 */
export function InspectorDrawer({
  target,
  detail,
  unit,
  graph,
  onSelect,
  onClose,
}: {
  target: SelectionTarget;
  detail: ForecastDetail;
  unit: string;
  graph: PipelineGraph;
  onSelect: (next: SelectionTarget) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const headerInfo = resolveHeader(target, detail, graph);
  const activeNode =
    target.kind === "node"
      ? graph.nodeMap.get(target.nodeId) ?? null
      : target.kind === "run"
        ? graph.nodeMap.get(`run:${target.runIndex}`) ?? null
        : null;

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.32)",
          zIndex: 44,
          animation: "libFadeIn 140ms ease",
        }}
      />
      <aside
        role="dialog"
        aria-label={headerInfo.title}
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: "min(700px, 95vw)",
          zIndex: 45,
          background: "var(--bg)",
          borderLeft: "1px solid var(--border)",
          boxShadow: "-10px 0 34px rgba(0,0,0,0.2)",
          display: "flex",
          flexDirection: "column",
          animation: "libSlideIn 160ms cubic-bezier(0.16, 1, 0.3, 1)",
        }}
      >
        {/* Drawer Header */}
        <div style={{ padding: "14px 18px 12px", borderBottom: "1px solid var(--border)", background: "var(--bg-subtle)" }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: 10.5,
                  fontWeight: 650,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: "var(--text-faint)",
                }}
              >
                {headerInfo.eyebrow}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2, flexWrap: "wrap" }}>
                <h2 style={{ fontSize: 16, fontWeight: 620, margin: 0, lineHeight: 1.3 }}>{headerInfo.title}</h2>
                {headerInfo.status && <DrawerStatusPill status={headerInfo.status} />}
              </div>
              {headerInfo.subtitle && (
                <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 4, lineHeight: 1.45 }}>
                  {headerInfo.subtitle}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close inspector"
              title="Close (Esc)"
              style={{
                ...buttonStyle,
                width: 30,
                height: 28,
                padding: 0,
                display: "grid",
                placeItems: "center",
                flexShrink: 0,
                background: "var(--bg-raised)",
              }}
            >
              ✕
            </button>
          </div>

          {/* Step-by-step Upstream / Downstream Navigation Bar */}
          {activeNode && (activeNode.upstream.length > 0 || activeNode.downstream.length > 0) && (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "6px 14px",
                marginTop: 10,
                paddingTop: 8,
                borderTop: "1px solid var(--border)",
                fontSize: 11.5,
              }}
            >
              {activeNode.upstream.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 4 }}>
                  <span style={{ color: "var(--text-faint)" }}>← Fed by:</span>
                  {activeNode.upstream.map((id) => {
                    const p = graph.nodeMap.get(id);
                    if (!p) return null;
                    return (
                      <NavChip
                        key={id}
                        label={p.title}
                        onClick={() =>
                          p.id === "question-info"
                            ? onSelect({ kind: "question" })
                            : p.runIndex != null
                              ? onSelect({ kind: "run", runIndex: p.runIndex })
                              : onSelect({ kind: "node", nodeId: p.id })
                        }
                      />
                    );
                  })}
                </div>
              )}
              {activeNode.downstream.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 4 }}>
                  <span style={{ color: "var(--text-faint)" }}>Feeds →</span>
                  {activeNode.downstream.map((id) => {
                    const ch = graph.nodeMap.get(id);
                    if (!ch) return null;
                    return (
                      <NavChip
                        key={id}
                        label={ch.title}
                        onClick={() =>
                          ch.runIndex != null
                            ? onSelect({ kind: "run", runIndex: ch.runIndex })
                            : onSelect({ kind: "node", nodeId: ch.id })
                        }
                      />
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Drawer Body */}
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "14px 18px 36px" }}>
          {target.kind === "node" && activeNode && (
            <NodeInspectorBody
              key={activeNode.id}
              node={activeNode}
              detail={detail}
              unit={unit}
              onSelect={onSelect}
            />
          )}
          {target.kind === "section" && (
            <SectionInspectorBody
              key={target.packetId}
              packet={graph.packets.find((p) => p.id === target.packetId) ?? null}
              onSelect={onSelect}
            />
          )}
          {target.kind === "run" && (
            <RunInspectorBody
              key={target.runIndex}
              runIndex={target.runIndex}
              detail={detail}
              unit={unit}
              graph={graph}
            />
          )}
          {target.kind === "system" && (
            <SystemInspectorBody
              key={target.systemId}
              system={graph.systems.find((s) => s.id === target.systemId) ?? null}
            />
          )}
          {target.kind === "cost" && <CostInspectorBody detail={detail} />}
          {target.kind === "question" && <QuestionInspectorBody detail={detail} unit={unit} />}
          {target.kind === "comment" && <CommentInspectorBody detail={detail} />}
          {target.kind === "files" && (
            <FilesInspectorBody
              runId={detail.runId}
              questionId={detail.questionId}
              initialFile={target.initialFile}
            />
          )}
        </div>
      </aside>
    </>
  );
}

/* ----------------------------------------------------------- header helper */

function resolveHeader(
  target: SelectionTarget,
  detail: ForecastDetail,
  graph: PipelineGraph,
): { eyebrow: string; title: string; subtitle?: string; status?: NodeStatus } {
  switch (target.kind) {
    case "node": {
      const n = graph.nodeMap.get(target.nodeId);
      if (!n) return { eyebrow: "Pipeline Step", title: target.nodeId };
      return {
        eyebrow: `${n.stage.toUpperCase()} · ${n.shape === "ellipse" ? "LLM / API" : n.shape === "diamond" ? "Output" : "Subsystem"}`,
        title: n.title,
        subtitle: n.roleSummary,
        status: n.status,
      };
    }
    case "section": {
      const pkt = graph.packets.find((p) => p.id === target.packetId);
      return {
        eyebrow: `SECTION LIST PACKET${pkt?.slotNumber ? ` · #${pkt.slotNumber}` : ""}`,
        title: `◆ ${pkt?.label ?? target.packetId}`,
        subtitle: pkt?.chars ? `${compactChars(pkt.chars)} characters collected into the Section List.` : "Not produced in this run.",
        status: pkt?.present ? "pass" : "skipped",
      };
    }
    case "run": {
      const run = detail.runs.find((r) => r.index === target.runIndex);
      const isRaw = graph.rawRunIndices.has(target.runIndex);
      return {
        eyebrow: `ENSEMBLE FORECASTER · ${isRaw ? "RAW RESEARCH VIEW" : "COMPILED BRIEF VIEW"}`,
        title: run ? `Run ${run.index} · ${run.model}` : `Run ${target.runIndex}`,
        subtitle: run?.dropped
          ? `Excluded from aggregate${run.error ? ` — ${run.error}` : ""}`
          : isRaw
            ? "Reads the uncompiled Section List + Artifact Check directly."
            : "Reads the Condensed Compiled Brief.",
        status: run?.dropped ? "warn" : run && !run.valid ? "fail" : "pass",
      };
    }
    case "system": {
      const sys = graph.systems.find((s) => s.id === target.systemId);
      return {
        eyebrow: "CENTRALISED SYSTEM",
        title: sys?.title ?? target.systemId,
        subtitle: sys ? `Fallback chain: ${sys.chain.join(" → ")}` : undefined,
        status: sys?.status,
      };
    }
    case "cost":
      return {
        eyebrow: "COST & LATENCY",
        title: "Spend, Quota & LLM Calls",
        subtitle: "Real dollars (OpenRouter native/price_table) and SoCLaaS quota microdollars reported separately.",
      };
    case "question":
      return {
        eyebrow: `METACULUS SNAPSHOT · Q${detail.questionId}`,
        title: "Question & Live Community Status",
        subtitle: `Closes ${formatDate(detail.question.closeTime)} · Resolves ${formatDate(detail.question.resolveTime)}`,
      };
    case "comment":
      return {
        eyebrow: "METACULUS SUBMISSION",
        title: "Posted Comment",
        subtitle: "Rationale posted alongside the submitted forecast.",
      };
    case "files":
      return {
        eyebrow: "STORED ARTIFACTS",
        title: "Raw Forecast Files",
        subtitle: "Decompressed markdown files stored under this run's prefix.",
      };
  }
}

/* ----------------------------------------------------------- 1. Node Body */

function NodeInspectorBody({
  node,
  detail,
  unit,
  onSelect,
}: {
  node: PipelineNode;
  detail: ForecastDetail;
  unit: string;
  onSelect: (next: SelectionTarget) => void;
}) {
  const hasSteps = node.lineageNodes.length > 0;
  const hasCalls = node.llmCalls.length > 0 || node.lineageCalls.length > 0;

  type SubTab = "output" | "steps" | "calls";
  const tabs: { key: SubTab; label: string }[] = [
    { key: "output", label: "Output" },
    ...(hasSteps ? [{ key: "steps" as const, label: `Steps & Cuts (${node.lineageNodes.length})` }] : []),
    ...(hasCalls ? [{ key: "calls" as const, label: `Calls (${node.llmCalls.length + node.lineageCalls.length})` }] : []),
  ];
  const [tab, setTab] = useState<SubTab>("output");

  return (
    <div>
      {tabs.length > 1 && <SubTabBar tabs={tabs} active={tab} onChange={setTab} />}

      {tab === "output" && (
        <div>
          {(node.id === "artifact-check-v1" || node.id === "artifact-check-v2") && (
            <ArtifactCheckContent
              check={node.id === "artifact-check-v1" ? detail.artifactCheckV1 ?? detail.artifactCheck : detail.artifactCheck}
              degradedProviders={detail.degradedProviders}
            />
          )}

          {node.id === "aggregation" && (
            <AggregationContent detail={detail} unit={unit} onSelect={onSelect} />
          )}

          {node.sections.length > 0 && (
            <div style={{ display: "grid", gap: 10 }}>
              {node.sections.map((sec, i) =>
                node.sections.length === 1 ? (
                  <div key={i}>
                    <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginBottom: 8 }}>
                      {sec.heading} · {compactChars(sec.chars)} chars
                    </div>
                    <Markdown>{sec.body}</Markdown>
                  </div>
                ) : (
                  <Collapsible
                    key={i}
                    label={`${sec.heading} (${compactChars(sec.chars)})`}
                    defaultOpen={i === 0}
                  >
                    <Markdown>{sec.body}</Markdown>
                  </Collapsible>
                ),
              )}
            </div>
          )}

          {node.sections.length === 0 &&
            node.id !== "artifact-check-v1" &&
            node.id !== "artifact-check-v2" &&
            node.id !== "aggregation" && (
              <>
                {node.lineageNodes.some((ln) => ln.output?.file) ? (
                  <div>
                    <Faint style={{ marginBottom: 8 }}>
                      No top-level section in <code>research.md</code>; saved step files from <code>run_lineage</code>:
                    </Faint>
                    {node.lineageNodes
                      .filter((ln) => ln.output?.file)
                      .map((ln) => (
                        <StepFileBox
                          key={ln.id}
                          title={`${ln.stage} · ${ln.label ?? ln.id} (${compactChars(ln.output?.chars)} chars)`}
                          file={ln.output!.file!}
                          runId={detail.runId}
                          questionId={detail.questionId}
                        />
                      ))}
                  </div>
                ) : (
                  <Faint>
                    {node.active
                      ? "This step executed without writing a standalone markdown section. Check Calls or Steps for telemetry."
                      : "This module did not execute or was not recorded in this run."}
                  </Faint>
                )}
              </>
            )}
        </div>
      )}

      {tab === "steps" && (
        <LineageStepsList
          nodes={node.lineageNodes}
          runId={detail.runId}
          questionId={detail.questionId}
        />
      )}

      {tab === "calls" && (
        <div style={{ display: "grid", gap: 16 }}>
          {node.llmCalls.length > 0 && <LlmCallsMiniTable calls={node.llmCalls} />}
          {node.lineageCalls.length > 0 && <HttpCallsMiniTable calls={node.lineageCalls} />}
        </div>
      )}
    </div>
  );
}

function ArtifactCheckContent({
  check,
  degradedProviders,
}: {
  check: ArtifactCheck | null;
  degradedProviders: string[];
}) {
  if (!check) return <Faint>No artifact check recorded for this run.</Faint>;
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
        <Tag tone={check.status === "complete" ? undefined : "warn"}>{check.status ?? "unknown"}</Tag>
        {check.forecast_swing && (
          <span style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
            Potential swing if missing data arrived: <strong>{check.forecast_swing}</strong>
          </span>
        )}
      </div>
      {check.what_was_found && <Field label="Found">{check.what_was_found}</Field>}
      {check.what_is_missing && <Field label="Missing">{check.what_is_missing}</Field>}
      {check.closest_available && <Field label="Closest available">{check.closest_available}</Field>}
      {check.retry_queries && check.retry_queries.length > 0 && (
        <Field label={`Pooled retry queries (${check.retry_queries.length})`}>
          <ul style={{ margin: "4px 0 0", paddingLeft: 18, fontSize: 12.5, fontFamily: "var(--font-mono)" }}>
            {check.retry_queries.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
        </Field>
      )}
      {degradedProviders.length > 0 && (
        <Field label="Degraded search providers">{degradedProviders.join(", ")}</Field>
      )}
    </div>
  );
}

function AggregationContent({
  detail: d,
  unit,
  onSelect,
}: {
  detail: ForecastDetail;
  unit: string;
  onSelect: (next: SelectionTarget) => void;
}) {
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div>
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 6 }}>Submitted Forecast</div>
        <ValueView value={d.final} unit={unit} />
      </div>
      <Faint>
        {d.type !== "binary"
          ? d.type === "multiple_choice"
            ? "Multiple choice: arithmetic mean across valid ensemble runs."
            : "Numeric / discrete: quantile average of valid run CDFs, then smoothed."
          : d.tiebreakerUsed
            ? "Binary: ensemble runs disagreed by ≥30 pts, so a tiebreaker run was submitted."
            : "Binary: median / weighted blend of valid ensemble runs."}
      </Faint>
      {d.curves && <SeriesTable curves={d.curves} unit={unit} />}
      <div style={{ display: "grid", gap: 4 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)" }}>Ensemble Members</div>
        {d.runs.map((r) => (
          <button
            key={r.index}
            type="button"
            onClick={() => onSelect({ kind: "run", runIndex: r.index })}
            className="lib-hover-surface"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "6px 8px",
              border: "1px solid var(--border)",
              borderRadius: 6,
              background: "var(--bg-subtle)",
              cursor: "pointer",
              fontSize: 12.5,
            }}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <RunDot color={r.dropped ? null : runColor(r.index)} />
              <span>Run {r.index} · <code>{shortModelName(r.model)}</code></span>
              {r.dropped && <Tag tone="warn">dropped</Tag>}
            </span>
            <span style={{ color: "var(--accent)", fontSize: 12 }}>Read reasoning →</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------- 2. Section Body */

function SectionInspectorBody({
  packet,
  onSelect,
}: {
  packet: SectionPacket | null;
  onSelect: (next: SelectionTarget) => void;
}) {
  if (!packet) return <Faint>Section packet not found.</Faint>;
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
          {packet.sections.length} section{packet.sections.length === 1 ? "" : "s"}
          {packet.chars ? ` · ${compactChars(packet.chars)} chars` : ""}
        </span>
        <button
          type="button"
          onClick={() => onSelect({ kind: "node", nodeId: packet.sourceNodeId })}
          style={{ ...buttonStyle, padding: "2px 9px", fontSize: 12 }}
        >
          Inspect producer module →
        </button>
      </div>
      {packet.sections.length === 0 ? (
        <Faint>No markdown text was emitted for this Section List slot in this run.</Faint>
      ) : (
        packet.sections.map((sec, idx) =>
          packet.sections.length === 1 ? (
            <Markdown key={idx}>{sec.body}</Markdown>
          ) : (
            <Collapsible key={idx} label={`${sec.heading} (${compactChars(sec.chars)})`} defaultOpen={idx === 0}>
              <Markdown>{sec.body}</Markdown>
            </Collapsible>
          ),
        )
      )}
    </div>
  );
}

/* ----------------------------------------------------------- 3. Run Body */

function RunInspectorBody({
  runIndex,
  detail: d,
  unit,
  graph,
}: {
  runIndex: number;
  detail: ForecastDetail;
  unit: string;
  graph: PipelineGraph;
}) {
  const run: RunEntry | undefined = d.runs.find((r) => r.index === runIndex);
  const runNode = graph.nodeMap.get(`run:${runIndex}`);
  const [runsText, setRunsText] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  type SubTab = "reasoning" | "spec" | "telemetry";
  const [tab, setTab] = useState<SubTab>("reasoning");

  useEffect(() => {
    let cancelled = false;
    getJson<{ text: string | null }>(fileUrl(d.runId, d.questionId, "runs"))
      .then(({ text }) => {
        if (!cancelled) setRunsText(text);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [d.runId, d.questionId]);

  const parsed = useMemo(() => (runsText ? fileSections(runsText, "runs") : []), [runsText]);
  const runSection = parsed.find((s) => s.heading === `Run ${runIndex}` || s.heading.startsWith(`Run ${runIndex} `));
  const sharedPrompt = parsed.find((s) => s.heading.startsWith("Prompt"));

  if (!run) return <Faint>Run {runIndex} not found.</Faint>;

  return (
    <div>
      <SubTabBar
        tabs={[
          { key: "reasoning", label: "Reasoning" },
          { key: "spec", label: "Forecast & Spec" },
          { key: "telemetry", label: "Calls & Steps" },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === "reasoning" && (
        <div>
          {run.dropped && (
            <Notice tone="warn">
              This run was dropped from the ensemble{run.error ? `: ${run.error}` : "."}
            </Notice>
          )}
          {error && <Notice tone="warn">{error}</Notice>}
          {runsText === undefined && !error && <Faint>Loading run transcript…</Faint>}
          {runsText === null && <Faint>No <code>runs.md</code> file stored for this forecast.</Faint>}
          {runsText != null && !runSection && (
            <Faint>No section matching <code>Run {runIndex}</code> in <code>runs.md</code>.</Faint>
          )}
          {runSection && <Markdown>{runSection.body}</Markdown>}
          {sharedPrompt && (
            <div style={{ marginTop: 16 }}>
              <Collapsible label={`Shared Forecaster Prompt (${compactChars(sharedPrompt.body.length)})`}>
                <Markdown>{sharedPrompt.body}</Markdown>
              </Collapsible>
            </div>
          )}
        </div>
      )}

      {tab === "spec" && (
        <div style={{ display: "grid", gap: 12 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
            <RunDot color={run.dropped ? null : runColor(run.index)} />
            <code style={{ fontFamily: "var(--font-mono)", fontSize: 13 }}>{run.model}</code>
            <Tag>{graph.rawRunIndices.has(run.index) ? "Raw research view" : "Compiled brief view"}</Tag>
            {run.repaired && <Tag>repaired</Tag>}
            {run.shadow && <Tag>shadow</Tag>}
            {run.flags.map((f) => (
              <Tag key={f} tone="warn">
                {f}
              </Tag>
            ))}
          </div>
          <Field label="Model Answer">
            <ValueView value={run.value} unit={unit} />
          </Field>
          {d.curves && <SeriesTable curves={d.curves} unit={unit} />}
        </div>
      )}

      {tab === "telemetry" && (
        <div style={{ display: "grid", gap: 14 }}>
          {runNode && runNode.llmCalls.length > 0 ? (
            <LlmCallsMiniTable calls={runNode.llmCalls} />
          ) : (
            <Faint>No per-run LLM call matched.</Faint>
          )}
          {runNode && runNode.lineageNodes.length > 0 && (
            <LineageStepsList
              nodes={runNode.lineageNodes}
              runId={d.runId}
              questionId={d.questionId}
            />
          )}
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------- 4. System Body */

function SystemInspectorBody({ system }: { system: SystemSummary | null }) {
  if (!system) return <Faint>System not found.</Faint>;
  return (
    <div style={{ display: "grid", gap: 14 }}>
      {/* Waterfall Chain */}
      <div>
        <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--text-muted)", marginBottom: 6 }}>
          Fallback Waterfall Order
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
          {system.chain.map((step, i) => (
            <span key={step} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              {i > 0 && <span style={{ color: "var(--text-faint)", fontSize: 12 }}>→</span>}
              <span
                style={{
                  fontSize: 12,
                  padding: "3px 9px",
                  borderRadius: 6,
                  border: "1px solid var(--border)",
                  background: "var(--bg-subtle)",
                }}
              >
                <span style={{ color: "var(--text-faint)", marginRight: 5, fontVariantNumeric: "tabular-nums" }}>
                  {i + 1}.
                </span>
                {step}
              </span>
            </span>
          ))}
        </div>
      </div>

      {system.notes.map((note, idx) => (
        <Notice key={idx} tone={system.status === "warn" || system.status === "fail" ? "warn" : undefined}>
          {note}
        </Notice>
      ))}

      {system.breakdown.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", fontSize: 12.5, width: "100%" }}>
            <thead>
              <tr style={{ color: "var(--text-muted)", textAlign: "left" }}>
                <th style={cellStyle}>Tier / Model</th>
                <th style={numStyle}>Calls</th>
                <th style={numStyle}>Failed</th>
                <th style={numStyle}>Time</th>
                {system.id === "soclaas" && <th style={numStyle}>Quota µ$</th>}
              </tr>
            </thead>
            <tbody>
              {system.breakdown.map((row) => (
                <tr key={row.label}>
                  <td style={cellStyle}>
                    <code style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{row.label}</code>
                    {row.detail && <span style={{ color: "var(--warn-text)", marginLeft: 6 }}>({row.detail})</span>}
                  </td>
                  <td style={numStyle}>{row.count}</td>
                  <td style={{ ...numStyle, color: row.failed ? "var(--st-fail)" : "var(--text-muted)" }}>
                    {row.failed || "0"}
                  </td>
                  <td style={numStyle}>{row.seconds ? compactSeconds(row.seconds) : "—"}</td>
                  {system.id === "soclaas" && (
                    <td style={numStyle}>{row.quotaMicro ? formatNumber(row.quotaMicro) : "—"}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {system.llmCalls.length > 0 && <LlmCallsMiniTable calls={system.llmCalls} />}
      {system.lineageCalls.length > 0 && <HttpCallsMiniTable calls={system.lineageCalls} />}
    </div>
  );
}

/* ---------------------------------------------------------- 5. Cost Body */

function CostInspectorBody({ detail: d }: { detail: ForecastDetail }) {
  type SubTab = "models" | "calls";
  const [tab, setTab] = useState<SubTab>("models");
  const t = d.timings;

  return (
    <div>
      {t?.total_seconds != null && (
        <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 10 }}>
          Total <strong>{compactSeconds(t.total_seconds)}</strong>
          {t.research_seconds != null && ` · research ${compactSeconds(t.research_seconds)}`}
          {t.forecast_seconds != null && ` · forecast ${compactSeconds(t.forecast_seconds)}`}
        </div>
      )}

      <SubTabBar
        tabs={[
          { key: "models", label: `By Model (${d.cost.length})` },
          { key: "calls", label: `All Calls (${d.llmCalls.length})` },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === "models" && (
        <>
          {d.cost.length ? (
            <div style={{ overflowX: "auto" }}>
              <table style={{ borderCollapse: "collapse", fontSize: 12.5, width: "100%" }}>
                <thead>
                  <tr style={{ color: "var(--text-muted)", textAlign: "left" }}>
                    <th style={cellStyle}>Model</th>
                    <th style={cellStyle}>Source</th>
                    <th style={numStyle}>Calls</th>
                    <th style={numStyle}>USD</th>
                    <th style={numStyle}>Quota µ$</th>
                    <th style={numStyle}>Tokens in / out</th>
                  </tr>
                </thead>
                <tbody>
                  {d.cost.map((c) => (
                    <tr key={`${c.model}|${c.source}`}>
                      <td style={cellStyle}>
                        <code style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{c.model}</code>
                      </td>
                      <td style={cellStyle}>{c.source}</td>
                      <td style={numStyle}>{c.calls}</td>
                      <td style={numStyle}>{c.usd ? `$${c.usd.toFixed(4)}` : "—"}</td>
                      <td style={numStyle}>{c.quotaMicro ? formatNumber(c.quotaMicro) : "—"}</td>
                      <td style={numStyle}>
                        {formatNumber(c.inputTokens)} / {formatNumber(c.outputTokens)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Faint>No cost records stored.</Faint>
          )}
          <Faint style={{ marginTop: 10 }}>
            &quot;native&quot; and &quot;price_table&quot; rows are real USD; &quot;quota&quot; rows are SoCLaaS allowance, never summed together.
          </Faint>
        </>
      )}

      {tab === "calls" && <LlmCallsMiniTable calls={d.llmCalls} />}
    </div>
  );
}

/* ------------------------------------------------------ 6. Question Body */

function QuestionInspectorBody({ detail: d, unit }: { detail: ForecastDetail; unit: string }) {
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 6 }}>
          Resolution Criteria
        </div>
        <Markdown>{d.question.resolutionCriteria || "_None recorded_"}</Markdown>
      </div>
      {d.question.fineprint && (
        <Collapsible label="Fine print" defaultOpen>
          <Markdown>{d.question.fineprint}</Markdown>
        </Collapsible>
      )}
      {d.question.description && (
        <Collapsible label="Background">
          <Markdown>{d.question.description}</Markdown>
        </Collapsible>
      )}
      {d.postId && <LiveMetaculusBox postId={d.postId} unit={unit} />}
    </div>
  );
}

function LiveMetaculusBox({ postId, unit }: { postId: number; unit: string }) {
  const [live, setLive] = useState<LiveQuestion | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState("");

  const load = () => {
    setState("loading");
    getJson<LiveQuestion>(`view=live&post=${postId}`)
      .then((v) => {
        setLive(v);
        setState("idle");
      })
      .catch((e: Error) => {
        setError(e.message);
        setState("error");
      });
  };

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "10px 12px", background: "var(--bg-subtle)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 12.5, fontWeight: 600 }}>On Metaculus Now</span>
        <button type="button" onClick={load} disabled={state === "loading"} style={{ ...buttonStyle, padding: "2px 10px" }}>
          {state === "loading" ? "Fetching…" : live ? "Refresh" : "Fetch live"}
        </button>
      </div>
      {state === "error" && <Notice tone="warn">{error}</Notice>}
      {!live && state !== "error" && (
        <Faint>Fetch current status, forecaster count, and community prediction (when visible to token).</Faint>
      )}
      {live && (
        <div style={{ fontSize: 12.5, display: "grid", gap: 8 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px" }}>
            <span><Muted>Status</Muted> {live.status ?? "—"}</span>
            {live.resolution && <span><Muted>Resolution</Muted> {live.resolution}</span>}
            <span><Muted>Forecasters</Muted> {live.forecasters ?? "—"}</span>
          </div>
          {live.community ? (
            <ValueView value={live.community} unit={unit} />
          ) : (
            <Faint>
              Community aggregate hidden for this token
              {live.cpRevealTime && new Date(live.cpRevealTime) > new Date()
                ? ` until ${formatDate(live.cpRevealTime)}.`
                : "."}
            </Faint>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------- 7. Comment Body */

function CommentInspectorBody({ detail: d }: { detail: ForecastDetail }) {
  const [copied, setCopied] = useState(false);
  if (!d.postedComment) return <Faint>No posted comment recorded on this forecast.</Faint>;

  const copy = () => {
    void navigator.clipboard?.writeText(d.postedComment!).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
        <button type="button" onClick={copy} style={{ ...buttonStyle, padding: "2px 10px", fontSize: 12 }}>
          {copied ? "Copied ✓" : "Copy markdown"}
        </button>
      </div>
      <Markdown>{d.postedComment}</Markdown>
    </div>
  );
}

/* --------------------------------------------------------- 8. Files Body */

const FILE_TABS: { key: FileKey; label: string }[] = [
  { key: "research", label: "Research" },
  { key: "runs", label: "Runs" },
  { key: "evolution", label: "Evolution" },
  { key: "audit", label: "Audit" },
  { key: "diagnostics", label: "Diagnostics" },
];

function FilesInspectorBody({
  runId,
  questionId,
  initialFile = "research",
}: {
  runId: string;
  questionId: number;
  initialFile?: FileKey;
}) {
  const [file, setFile] = useState<FileKey>(initialFile);
  const [texts, setTexts] = useState<Partial<Record<FileKey, string | null>>>({});
  const [errors, setErrors] = useState<Partial<Record<FileKey, string>>>({});

  useEffect(() => {
    if (file in texts) return;
    getJson<{ text: string | null }>(fileUrl(runId, questionId, file))
      .then(({ text }) => setTexts((t) => ({ ...t, [file]: text })))
      .catch((e: Error) => setErrors((all) => ({ ...all, [file]: e.message })));
  }, [file, texts, runId, questionId]);

  const text = texts[file];
  const error = errors[file];
  const parts = useMemo(() => (text ? fileSections(text, file) : []), [text, file]);

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 5, marginBottom: 12 }}>
        {FILE_TABS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            aria-pressed={file === key}
            onClick={() => setFile(key)}
            style={{ ...buttonStyle, padding: "3px 10px", background: file === key ? "var(--bg-active)" : "transparent" }}
          >
            {label}
          </button>
        ))}
        {text != null && (
          <a
            href={downloadHref(runId, questionId, file)}
            download
            style={{ marginLeft: "auto", fontSize: 12, color: "var(--accent)" }}
          >
            Download {file}.md ↓
          </a>
        )}
      </div>
      {error && <Notice tone="warn">{error}</Notice>}
      {!error && !(file in texts) && <Faint>Loading…</Faint>}
      {text === null && <Faint>Not produced for this run.</Faint>}
      {parts.map((part, i) =>
        part.heading ? (
          <Collapsible key={`${file}-${i}`} label={`${part.heading} (${compactChars(part.body.length)})`} defaultOpen={i === 0}>
            <Markdown>{part.body}</Markdown>
          </Collapsible>
        ) : (
          <Markdown key={`${file}-${i}`}>{part.body}</Markdown>
        ),
      )}
    </div>
  );
}

/* ----------------------------------------------------- shared sub-tables */

function LineageStepsList({
  nodes,
  runId,
  questionId,
}: {
  nodes: LineageNode[];
  runId: string;
  questionId: number;
}) {
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {nodes.map((ln) => {
        const inChars = ln.input?.chars;
        const outChars = ln.output?.chars;
        return (
          <div
            key={ln.id}
            style={{
              border: "1px solid var(--border)",
              borderRadius: 7,
              padding: "8px 10px",
              background: "var(--bg-subtle)",
              fontSize: 12.5,
            }}
          >
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
              <span style={{ fontWeight: 580, wordBreak: "break-word" }}>
                <code style={{ fontSize: 11.5, color: "var(--text-muted)", marginRight: 6 }}>{ln.stage}</code>
                {ln.label || ln.id}
              </span>
              <span style={{ fontSize: 11.5, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                {inChars != null && inChars > 0 ? `${compactChars(inChars)} → ` : ""}
                {outChars != null ? `${compactChars(outChars)}` : ""}
                {ln.duration_s != null ? ` · ${compactSeconds(ln.duration_s)}` : ""}
              </span>
            </div>
            {ln.error && (
              <div style={{ color: "var(--st-fail)", fontSize: 12, marginTop: 4 }}>{ln.error}</div>
            )}
            {ln.cuts.map((c, idx) => (
              <div
                key={idx}
                style={{
                  marginTop: 5,
                  padding: "4px 8px",
                  borderRadius: 5,
                  background: "var(--st-warn-bg)",
                  color: "var(--st-warn)",
                  fontSize: 11.5,
                }}
              >
                ✂ kept {compactChars(c.kept)}
                {c.of ? ` of ${compactChars(c.of)} (${Math.round(((c.kept ?? 0) / c.of) * 100)}%)` : ""} — {c.reason}
              </div>
            ))}
            {ln.output?.file && (
              <div style={{ marginTop: 6 }}>
                <StepFileBox title="Saved step output" file={ln.output.file} runId={runId} questionId={questionId} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function StepFileBox({
  title,
  file,
  runId,
  questionId,
}: {
  title: string;
  file: string;
  runId: string;
  questionId: number;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState<string | null | undefined>(undefined);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    if (!open || text !== undefined) return;
    getJson<{ text: string | null }>(
      `view=step&run=${encodeURIComponent(runId)}&q=${questionId}&file=${encodeURIComponent(file)}`,
    )
      .then(({ text: t }) => setText(t))
      .catch(() => setText(null));
  }, [open, text, runId, questionId, file]);

  return (
    <details
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
      style={{ border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)", marginTop: 4 }}
    >
      <summary style={{ padding: "5px 9px", cursor: "pointer", fontSize: 12, color: "var(--text-muted)" }}>
        {title} <code style={{ fontSize: 11, color: "var(--text-faint)" }}>({file})</code>
      </summary>
      <div style={{ padding: "6px 10px 10px" }}>
        {open && text === undefined && <Faint>Loading…</Faint>}
        {text === null && <Faint>Step file not uploaded for this run.</Faint>}
        {text && (
          <>
            <pre
              style={{
                margin: 0,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                fontFamily: "var(--font-mono)",
                fontSize: 11.5,
                lineHeight: 1.5,
                maxHeight: 340,
                overflowY: "auto",
              }}
            >
              {showAll || text.length <= STEP_PREVIEW_LIMIT
                ? text
                : `${text.slice(0, STEP_PREVIEW_LIMIT)}\n\n… ${compactChars(text.length - STEP_PREVIEW_LIMIT)} more chars`}
            </pre>
            {text.length > STEP_PREVIEW_LIMIT && (
              <button
                type="button"
                onClick={() => setShowAll((v) => !v)}
                style={{ ...buttonStyle, marginTop: 6, padding: "2px 8px", fontSize: 11.5 }}
              >
                {showAll ? "Show less" : `Show all ${compactChars(text.length)}`}
              </button>
            )}
          </>
        )}
      </div>
    </details>
  );
}

function LlmCallsMiniTable({ calls }: { calls: LlmCall[] }) {
  if (!calls.length) return <Faint>No LLM calls recorded.</Faint>;
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ borderCollapse: "collapse", fontSize: 12, width: "100%" }}>
        <thead>
          <tr style={{ color: "var(--text-muted)", textAlign: "left" }}>
            <th style={cellStyle}>#</th>
            <th style={cellStyle}>Task</th>
            <th style={cellStyle}>Model</th>
            <th style={numStyle}>Tokens in / out</th>
            <th style={numStyle}>Cost / Quota</th>
            <th style={numStyle}>Time</th>
          </tr>
        </thead>
        <tbody>
          {calls.map((c) => {
            const isQuota = c.source === "quota" || (c.usd === 0 && c.quotaMicro > 0);
            return (
              <tr key={c.callNo}>
                <td style={{ ...cellStyle, color: "var(--text-faint)", fontVariantNumeric: "tabular-nums" }}>{c.callNo}</td>
                <td style={{ ...cellStyle, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis" }} title={c.task}>
                  <code>{c.task}</code>
                </td>
                <td style={cellStyle}>
                  <code style={{ fontFamily: "var(--font-mono)" }}>{shortModelName(c.model)}</code>
                </td>
                <td style={numStyle}>
                  {formatNumber(c.inputTokens)} / {formatNumber(c.outputTokens)}
                  {c.reasoningTokens > 0 && (
                    <span style={{ color: "var(--text-faint)" }}> ({formatNumber(c.reasoningTokens)} r)</span>
                  )}
                </td>
                <td style={numStyle}>
                  {isQuota
                    ? `${formatNumber(c.quotaMicro)} µ$`
                    : c.usd
                      ? `$${c.usd.toFixed(4)}`
                      : "—"}
                </td>
                <td style={numStyle}>{c.seconds != null ? compactSeconds(c.seconds) : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function HttpCallsMiniTable({ calls }: { calls: LineageCall[] }) {
  return (
    <div>
      <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--text-muted)", marginBottom: 6 }}>
        HTTP / Scrape / Tool Requests ({calls.length})
      </div>
      <div style={{ display: "grid", gap: 4 }}>
        {calls.map((c) => {
          const bad = c.failed || (c.status_code ?? 0) >= 400;
          return (
            <div
              key={c.id}
              style={{
                padding: "5px 8px",
                borderRadius: 6,
                border: "1px solid var(--border)",
                background: "var(--bg-subtle)",
                fontSize: 12,
              }}
            >
              <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 10px", alignItems: "center" }}>
                <strong>{c.service ?? c.kind}</strong>
                {c.status_code != null && (
                  <span style={{ color: bad ? "var(--st-fail)" : "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>
                    HTTP {c.status_code}
                  </span>
                )}
                {c.duration_s != null && <span style={{ color: "var(--text-muted)" }}>{compactSeconds(c.duration_s)}</span>}
                {c.returned != null && c.returned !== "" && (
                  <span style={{ color: "var(--text-muted)" }}>{String(c.returned)}</span>
                )}
              </div>
              {c.request && (
                <div
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    color: "var(--text-muted)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    marginTop: 2,
                  }}
                  title={c.request}
                >
                  {c.request}
                </div>
              )}
              {c.outcome && <div style={{ color: "var(--st-fail)", fontSize: 11.5, marginTop: 2 }}>{c.outcome}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------- tiny atoms */

function SubTabBar<K extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: { key: K; label: string }[];
  active: K;
  onChange: (key: K) => void;
}) {
  return (
    <div
      role="tablist"
      style={{
        display: "inline-flex",
        gap: 2,
        padding: 3,
        borderRadius: 8,
        background: "var(--bg-subtle)",
        border: "1px solid var(--border)",
        marginBottom: 14,
      }}
    >
      {tabs.map((t) => {
        const isCurrent = t.key === active;
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={isCurrent}
            onClick={() => onChange(t.key)}
            style={{
              padding: "4px 11px",
              borderRadius: 6,
              border: "none",
              background: isCurrent ? "var(--bg-raised)" : "transparent",
              boxShadow: isCurrent ? "0 1px 2px rgba(0,0,0,0.08)" : "none",
              fontSize: 12,
              fontWeight: isCurrent ? 600 : 450,
              color: isCurrent ? "var(--text)" : "var(--text-muted)",
              cursor: "pointer",
            }}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

function NavChip({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="lib-hover-surface"
      style={{
        padding: "1px 8px",
        borderRadius: 999,
        border: "1px solid var(--border)",
        background: "var(--bg-raised)",
        fontSize: 11.5,
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

function DrawerStatusPill({ status }: { status: NodeStatus }) {
  const tone: Record<NodeStatus, { fg: string; bg: string; label: string }> = {
    pass: { fg: "var(--st-pass)", bg: "var(--st-pass-bg)", label: "✓ active" },
    warn: { fg: "var(--st-warn)", bg: "var(--st-warn-bg)", label: "! attention" },
    fail: { fg: "var(--st-fail)", bg: "var(--st-fail-bg)", label: "✕ failed" },
    skipped: { fg: "var(--st-skipped)", bg: "var(--st-skipped-bg)", label: "– inactive" },
  };
  const s = tone[status];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "1px 8px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 600,
        color: s.fg,
        background: s.bg,
      }}
    >
      {s.label}
    </span>
  );
}

export function DrawerHint({ children }: { children: ReactNode }) {
  return <div style={{ fontSize: 12, color: "var(--text-faint)" }}>{children}</div>;
}
