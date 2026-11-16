import { fileSections } from "./files.ts";
import type {
  FileKey,
  ForecastDetail,
  LineageCall,
  LineageDoc,
  LineageNode,
  LlmCall,
} from "./types.ts";

/**
 * Pure pipeline synthesizer: maps a forecast's stored JSON (`ForecastDetail`),
 * decompressed `research.md` sections, and optional `run_lineage` document onto
 * the 5-stage Excalidraw architecture + 3 centralised systems.
 *
 * Designed for 2-tier hydration and forward compatibility:
 * - Works immediately from `ForecastDetail` alone, enriches with exact section
 *   char counts once `research.md` loads, and adds scrape/cut/step precision
 *   when `run_lineage` exists.
 * - Any new/unrecognised `## Provider: <Name>` section, lineage lane, or LLM
 *   task automatically spawns a dynamic node in Stage 3 + a `◆` Section Packet.
 */

export type NodeShape = "rect" | "ellipse" | "diamond";
export type NodeStatus = "pass" | "warn" | "fail" | "skipped";
export type PipelineStageId = "input" | "grounding" | "planning" | "research" | "verification" | "synthesis";

export type PipelineSection = {
  heading: string;
  body: string;
  chars: number;
};

export type PipelineNode = {
  id: string;
  stage: PipelineStageId;
  /** Visual grammar from Excalidraw: rect = subsystem/code, ellipse = LLM/API, diamond = packet. */
  shape: NodeShape;
  title: string;
  /** Optional tiny badge on the card, e.g. "↻ 3x", "4×", "Raw", "Brief". */
  badge?: string;
  status: NodeStatus;
  /** True if this step executed or emitted data in this run. */
  active: boolean;
  /** True for dynamically discovered future bot modules. */
  dynamic?: boolean;
  /** At most 2 ultra-compact tabular chips rendered on the canvas card. */
  metrics: string[];
  upstream: string[];
  downstream: string[];
  /** Concise 1-sentence explanation shown inside the Inspector Drawer, never on the canvas. */
  roleSummary: string;
  sections: PipelineSection[];
  llmCalls: LlmCall[];
  lineageNodes: LineageNode[];
  lineageCalls: LineageCall[];
  runIndex?: number;
};

export type SectionPacket = {
  id: string;
  slotNumber?: number;
  label: string;
  chars: number | null;
  present: boolean;
  sourceNodeId: string;
  sections: PipelineSection[];
};

export type SystemBreakdownRow = {
  label: string;
  count: number;
  failed: number;
  seconds: number;
  quotaMicro?: number;
  usd?: number;
  detail?: string;
};

export type SystemSummary = {
  id: "fetcher" | "searcher" | "soclaas";
  title: string;
  status: NodeStatus;
  pill: string;
  chain: string[];
  breakdown: SystemBreakdownRow[];
  notes: string[];
  lineageCalls: LineageCall[];
  llmCalls: LlmCall[];
};

export type PipelineGraph = {
  nodes: PipelineNode[];
  nodeMap: Map<string, PipelineNode>;
  packets: SectionPacket[];
  systems: SystemSummary[];
  /** Forecaster run indices augmented with raw-research detection from lineage/runs. */
  rawRunIndices: Set<number>;
  hasRetry: boolean;
  totalSectionChars: number;
  briefChars: number | null;
};

export type SelectionTarget =
  | { kind: "node"; nodeId: string }
  | { kind: "section"; packetId: string }
  | { kind: "run"; runIndex: number }
  | { kind: "system"; systemId: "fetcher" | "searcher" | "soclaas" }
  | { kind: "cost" }
  | { kind: "question" }
  | { kind: "comment" }
  | { kind: "files"; initialFile?: FileKey };

/* --------------------------------------------------------- compact formatters */

export function compactChars(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n <= 0) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 100_000 ? 0 : 1).replace(/\.0$/, "")}k`;
  return `${n}c`;
}

export function compactSeconds(s: number | null | undefined): string {
  if (s == null || !Number.isFinite(s) || s <= 0) return "";
  if (s < 1) return `${Math.round(s * 1000)}ms`;
  if (s < 60) return `${Math.round(s)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s % 60);
  return rem ? `${m}m ${rem}s` : `${m}m`;
}

export function shortModelName(model: string): string {
  const tail = model.includes("/") ? model.split("/").pop()! : model;
  return tail
    .replace(/^claude-/, "")
    .replace(/-\d{8}$/, "");
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "module";
}

function worstStatus(statuses: NodeStatus[]): NodeStatus {
  const rank: Record<NodeStatus, number> = { fail: 3, warn: 2, pass: 1, skipped: 0 };
  let best: NodeStatus = "skipped";
  for (const s of statuses) {
    if (rank[s] > rank[best]) best = s;
  }
  return best;
}

function mapLineageStatus(s: string): NodeStatus {
  if (s === "fail") return "fail";
  if (s === "warn") return "warn";
  if (s === "pass") return "pass";
  return "skipped";
}

/* ----------------------------------------------------- canonical classification */

type CanonicalModuleId =
  | "question-info"
  | "resolution-source"
  | "source-explorer"
  | "asknews"
  | "public-data"
  | "evidence-plan"
  | "markets"
  | "web-search"
  | "history-builder"
  | "artifact-check-v1"
  | "focus-retry"
  | "artifact-check-v2"
  | "brief-compiler"
  | "raw-view"
  | "aggregation";

/** Classify a `## Provider: <Name>` heading from research.md. Returns null if dynamic/unknown. */
function classifyProviderHeading(providerName: string): CanonicalModuleId | null {
  const s = providerName.trim().toLowerCase();
  if (/explorer/.test(s)) return "source-explorer";
  if (/resolution|criteria|wayback|measured series/.test(s)) return "resolution-source";
  if (/asknews/.test(s)) return "asknews";
  if (/public data|api ?agent/.test(s)) return "public-data";
  if (/evidence plan/.test(s)) return "evidence-plan";
  if (/kalshi|manifold|polymarket|market/.test(s)) return "markets";
  if (/history/.test(s)) return "history-builder";
  if (/focused artifact retry|artifact retry|retry/.test(s)) return "focus-retry";
  if (/tavily|serpapi|firecrawl|web search|google|bing|search|final research/.test(s)) return "web-search";
  return null;
}

/** Classify an `llm_calls.task` string to its pipeline node. */
function classifyLlmTask(task: string): CanonicalModuleId | "forecaster" | null {
  const s = task.trim().toLowerCase();
  if (/tiebreak|extrem|aggregat/.test(s)) return "aggregation";
  if (/forecast|repair/.test(s)) return "forecaster";
  if (/compiler|research-brief|precompress|condens|brief/.test(s)) return "brief-compiler";
  if (/artifact[-_ ]?check.*v2|post[-_ ]?retry|reconcile/.test(s)) return "artifact-check-v2";
  if (/artifact[-_ ]?check/.test(s)) return "artifact-check-v1";
  if (/retry/.test(s)) return "focus-retry";
  if (/evidence[-_ ]?plan|^plan$/.test(s)) return "evidence-plan";
  if (/asknews/.test(s)) return "asknews";
  if (/api[-_ ]?agent|public[-_ ]?data/.test(s)) return "public-data";
  if (/explorer/.test(s)) return "source-explorer";
  if (/resolution|criteria|wayback|measured/.test(s)) return "resolution-source";
  if (/market|kalshi|manifold|polymarket/.test(s)) return "markets";
  if (/history/.test(s)) return "history-builder";
  if (/serp|tavily|firecrawl|search|query|rank|extract|scrape/.test(s)) return "web-search";
  return null;
}

/** Classify a `LineageNode` to a canonical module, `"forecaster"`, or `null` (dynamic). */
function classifyLineageNode(n: LineageNode): CanonicalModuleId | "forecaster" | null {
  const stage = n.stage.toLowerCase();
  const lane = (n.lane ?? "").toLowerCase();
  const label = (n.label ?? "").toLowerCase();
  const pass = (n.pass ?? "").toLowerCase();

  if (stage === "input") return "question-info";
  if (stage === "forecast") return "forecaster";
  if (stage === "precompress" || stage === "compiler_input" || stage === "brief") {
    return "brief-compiler";
  }
  if (stage === "artifact_check") {
    return /v2|post-retry|reconcile/.test(label) ? "artifact-check-v2" : "artifact-check-v1";
  }
  if (stage === "retry_decision" || pass === "retry" || /focused artifact retry/.test(label)) {
    return "focus-retry";
  }
  if (stage === "evidence_plan" || /evidence plan/.test(label)) return "evidence-plan";
  if (/explorer/.test(stage) || /explorer/.test(lane) || /explorer/.test(label)) return "source-explorer";
  if (/resolution criteria/.test(lane) || /wayback|measured_series/.test(stage)) return "resolution-source";
  if (/asknews/.test(lane) || /asknews/.test(stage)) return "asknews";
  if (/api ?agent|public data/.test(lane) || stage === "apiagent") return "public-data";
  if (/kalshi|manifold|polymarket|market/.test(lane) || /market/.test(stage)) return "markets";
  if (/history/.test(lane) || /history/.test(stage)) return "history-builder";
  if (/tavily|serp|firecrawl|web search|search/.test(lane) || ["search_results", "rank", "extract_report", "search_chain"].includes(stage)) {
    return "web-search";
  }
  if (stage === "scrape") return "web-search";
  return null;
}

/* ----------------------------------------------------------- graph synthesizer */

export function buildPipelineGraph(
  detail: ForecastDetail,
  researchText?: string | null,
  lineage?: LineageDoc | null,
): PipelineGraph {
  const parsedSections = researchText ? fileSections(researchText, "research") : [];

  // Bucket sections, LLM calls, and lineage nodes by module id.
  const sectionsByModule = new Map<string, PipelineSection[]>();
  const llmByModule = new Map<string, LlmCall[]>();
  const lineageByModule = new Map<string, LineageNode[]>();
  const dynamicTitles = new Map<string, string>();

  const addSection = (id: string, sec: PipelineSection) => {
    sectionsByModule.set(id, [...(sectionsByModule.get(id) ?? []), sec]);
  };
  const addLlm = (id: string, call: LlmCall) => {
    llmByModule.set(id, [...(llmByModule.get(id) ?? []), call]);
  };
  const addLineage = (id: string, node: LineageNode) => {
    lineageByModule.set(id, [...(lineageByModule.get(id) ?? []), node]);
  };

  let briefChars: number | null = null;

  // 1. Classify sections from research.md
  for (const part of parsedSections) {
    const sec: PipelineSection = { heading: part.heading, body: part.body, chars: part.body.length };
    if (part.heading === "Preamble") {
      addSection("evidence-plan", sec);
    } else if (part.heading.startsWith("Compiled Brief")) {
      briefChars = sec.chars;
      addSection("brief-compiler", sec);
    } else if (part.heading.startsWith("Provider:")) {
      const name = part.heading.replace(/^Provider:\s*/i, "").trim();
      const canonical = classifyProviderHeading(name);
      if (canonical) {
        addSection(canonical, sec);
      } else {
        const dynId = `dyn:${slugify(name)}`;
        dynamicTitles.set(dynId, name);
        addSection(dynId, sec);
      }
    }
  }

  // 2. Classify LLM calls (also split V1 vs V2 artifact check if retry calls exist)
  const forecasterCalls: LlmCall[] = [];
  let sawRetryCall = false;
  for (const call of detail.llmCalls) {
    const cls = classifyLlmTask(call.task);
    if (cls === "focus-retry") sawRetryCall = true;
    if (cls === "forecaster") {
      forecasterCalls.push(call);
    } else if (cls === "artifact-check-v1" && sawRetryCall) {
      addLlm("artifact-check-v2", call);
    } else if (cls) {
      addLlm(cls, call);
    } else {
      const cleanName = call.task.replace(/\[.*\]$/, "").trim() || "Custom Step";
      const dynId = `dyn:${slugify(cleanName)}`;
      if (!dynamicTitles.has(dynId)) dynamicTitles.set(dynId, cleanName);
      addLlm(dynId, call);
    }
  }

  // 3. Classify lineage nodes & calls
  const callsByNodeId = new Map<string, LineageCall[]>();
  const rawRunIndices = new Set<number>(
    detail.runs.filter((r) => r.rawResearch).map((r) => r.index),
  );
  const lineageByRun = new Map<number, LineageNode[]>();

  if (lineage) {
    for (const c of lineage.calls) {
      if (c.node_id) callsByNodeId.set(c.node_id, [...(callsByNodeId.get(c.node_id) ?? []), c]);
    }
    for (const n of lineage.nodes) {
      const cls = classifyLineageNode(n);
      if (cls === "forecaster") {
        const m = /run\s+(\d+)/i.exec(n.label ?? "");
        const idx = m ? Number(m[1]) : null;
        if (idx != null) {
          lineageByRun.set(idx, [...(lineageByRun.get(idx) ?? []), n]);
          if (/raw research|raw view/i.test(n.label ?? "")) rawRunIndices.add(idx);
        }
      } else if (cls) {
        addLineage(cls, n);
      } else {
        const name = (n.lane && n.lane !== "*" ? n.lane : n.stage).trim();
        const dynId = `dyn:${slugify(name)}`;
        if (!dynamicTitles.has(dynId)) dynamicTitles.set(dynId, name);
        addLineage(dynId, n);
      }
    }
  }

  // Helper to construct a canonical or dynamic module node cleanly.
  const makeNode = (opts: {
    id: string;
    stage: PipelineStageId;
    shape: NodeShape;
    title: string;
    roleSummary: string;
    upstream: string[];
    downstream: string[];
    badge?: string;
    dynamic?: boolean;
    forceActive?: boolean;
    forceStatus?: NodeStatus;
    customMetrics?: string[];
  }): PipelineNode => {
    const secs = sectionsByModule.get(opts.id) ?? [];
    const llms = llmByModule.get(opts.id) ?? [];
    const lNodes = lineageByModule.get(opts.id) ?? [];
    const lCalls = lNodes.flatMap((n) => callsByNodeId.get(n.id) ?? []);

    const secChars = secs.reduce((sum, s) => sum + s.chars, 0);
    const providerNodes = lNodes.filter((n) => n.stage === "provider");
    const lineageChars = providerNodes.length
      ? providerNodes.reduce((sum, n) => sum + (n.output?.chars ?? 0), 0)
      : lNodes.reduce((sum, n) => Math.max(sum, n.output?.chars ?? 0), 0);
    const outChars = secChars || lineageChars;

    const active = Boolean(opts.forceActive || secs.length || llms.length || lNodes.some((n) => n.status !== "unused"));

    let status: NodeStatus = opts.forceStatus ?? "skipped";
    if (!opts.forceStatus) {
      if (lNodes.length) {
        status = worstStatus(lNodes.map((n) => mapLineageStatus(n.status)));
        if (status === "skipped" && active) status = "pass";
      } else if (active) {
        status = "pass";
      }
    }

    const metrics: string[] = opts.customMetrics ? [...opts.customMetrics] : [];
    if (!opts.customMetrics) {
      if (outChars > 0) metrics.push(compactChars(outChars));
      if (llms.length > 0 && metrics.length < 2) {
        metrics.push(`${llms.length} ${llms.length === 1 ? "call" : "calls"}`);
      } else if (lCalls.length > 0 && metrics.length < 2) {
        metrics.push(`${lCalls.length} req`);
      }
    }

    return {
      id: opts.id,
      stage: opts.stage,
      shape: opts.shape,
      title: opts.title,
      badge: opts.badge,
      status,
      active,
      dynamic: opts.dynamic,
      metrics: metrics.slice(0, 2),
      upstream: opts.upstream,
      downstream: opts.downstream,
      roleSummary: opts.roleSummary,
      sections: secs,
      llmCalls: llms,
      lineageNodes: lNodes,
      lineageCalls: lCalls,
    };
  };

  // Compute stage-specific compact metrics (max 2 short chips per card).
  const qChars =
    detail.question.resolutionCriteria.length +
    detail.question.description.length +
    detail.question.fineprint.length;

  const resNodes = lineageByModule.get("resolution-source") ?? [];
  const resScrapes = resNodes.filter((n) => n.stage === "scrape").length;

  const apiCalls = llmByModule.get("public-data") ?? [];
  const apiSteps = (lineageByModule.get("public-data") ?? []).filter((n) => n.stage === "apiagent").length || apiCalls.length;

  const webNodes = lineageByModule.get("web-search") ?? [];
  const extractCycles = webNodes.filter((n) => n.stage === "extract_report").length;
  const webScrapes = webNodes.filter((n) => n.stage === "scrape").length;

  const marketSecs = sectionsByModule.get("markets") ?? [];
  const marketNodes = (lineageByModule.get("markets") ?? []).filter((n) => n.stage === "provider");
  const marketSourcesCount = marketSecs.length || marketNodes.length;

  const ac = detail.artifactCheck;
  const acV1 = detail.artifactCheckV1 ?? ac;
  const retryQueriesCount = acV1?.retry_queries?.length ?? 0;
  const hasRetry = Boolean(
    (sectionsByModule.get("focus-retry")?.length ?? 0) > 0 ||
      (llmByModule.get("focus-retry")?.length ?? 0) > 0 ||
      (lineageByModule.get("focus-retry") ?? []).some((n) => n.status !== "unused") ||
      (lineageByModule.get("artifact-check-v2")?.length ?? 0) > 0,
  );

  const acStatus: NodeStatus = !ac
    ? "skipped"
    : ac.status === "complete"
      ? "pass"
      : ac.status === "partial"
        ? "warn"
        : ac.status === "missing"
          ? "fail"
          : "pass";

  // Dynamic Stage-3 nodes (future bot additions)
  const dynamicIds = [...dynamicTitles.keys()];

  // Forecaster context split: which runs read Compiled Brief vs Raw Research?
  const hasRawBranch = rawRunIndices.size > 0;
  const hasBriefBranch = detail.runs.some((r) => !rawRunIndices.has(r.index)) || briefChars != null;

  const acTerminalId = hasRetry ? "artifact-check-v2" : "artifact-check-v1";
  const synthesisTargets = [
    ...(hasBriefBranch ? ["brief-compiler"] : []),
    ...(hasRawBranch ? ["raw-view"] : []),
  ];

  // Build canonical nodes in topological order
  const nodes: PipelineNode[] = [
    makeNode({
      id: "question-info",
      stage: "input",
      shape: "rect",
      title: "Question Info",
      roleSummary: "Metaculus snapshot: title, resolution criteria, fine print, and background.",
      upstream: [],
      downstream: ["resolution-source", "asknews", "public-data", "evidence-plan"],
      forceActive: true,
      forceStatus: "pass",
      customMetrics: [qChars ? compactChars(qChars) : `Q${detail.questionId}`],
    }),

    // Stage 1: Initial Grounding
    makeNode({
      id: "resolution-source",
      stage: "grounding",
      shape: "rect",
      title: "Resolution Source",
      roleSummary: "Splits criteria URLs, checks measured Treasury/FRED series, scrapes embedded tables, and checks 18m Wayback snapshots.",
      upstream: ["question-info"],
      downstream: ["source-explorer"],
      customMetrics: (() => {
        const chars = (sectionsByModule.get("resolution-source") ?? []).reduce((a, s) => a + s.chars, 0) ||
          resNodes.filter((n) => n.stage === "provider").reduce((a, n) => a + (n.output?.chars ?? 0), 0);
        return [
          ...(chars ? [compactChars(chars)] : []),
          ...(resScrapes ? [`${resScrapes} URLs`] : []),
        ];
      })(),
    }),
    makeNode({
      id: "source-explorer",
      stage: "grounding",
      shape: "ellipse",
      title: "Source Explorer",
      badge: "Agent",
      roleSummary: "Multi-turn agent navigating the resolution source domain (up to 8 turns / 60 pages) to locate exact series or tables.",
      upstream: ["resolution-source"],
      downstream: ["artifact-check-v1"],
    }),
    makeNode({
      id: "asknews",
      stage: "grounding",
      shape: "ellipse",
      title: "AskNews",
      roleSummary: "Fetches recent (48h) + archival (160d) news articles and runs an LLM relevance filter without altering article text.",
      upstream: ["question-info"],
      downstream: ["evidence-plan", "web-search", "artifact-check-v1"],
    }),
    makeNode({
      id: "public-data",
      stage: "grounding",
      shape: "ellipse",
      title: "Public Data API",
      badge: apiSteps ? `${apiSteps}t` : undefined,
      roleSummary: "Multi-turn tool loop over 28 structured public data APIs (apiagent-kit: FRED, World Bank, BLS, EIA, etc.).",
      upstream: ["question-info"],
      downstream: ["artifact-check-v1"],
      customMetrics: (() => {
        const chars = (sectionsByModule.get("public-data") ?? []).reduce((a, s) => a + s.chars, 0) ||
          (lineageByModule.get("public-data") ?? []).filter((n) => n.stage === "provider").reduce((a, n) => a + (n.output?.chars ?? 0), 0);
        return [
          ...(chars ? [compactChars(chars)] : []),
          ...(apiSteps ? [`${apiSteps} steps`] : []),
        ];
      })(),
    }),

    // Stage 2: Evidence Plan Hub
    makeNode({
      id: "evidence-plan",
      stage: "planning",
      shape: "ellipse",
      title: "Evidence Plan",
      roleSummary: "7-part research plan: required artifact, main signal, resolution mechanics, proxies, background, gaps, and preferred search queries.",
      upstream: ["question-info", "asknews"],
      downstream: ["markets", "web-search", "history-builder", ...dynamicIds, "artifact-check-v1"],
      forceActive: Boolean(
        (sectionsByModule.get("evidence-plan")?.length ?? 0) > 0 ||
          (llmByModule.get("evidence-plan")?.length ?? 0) > 0 ||
          (lineageByModule.get("evidence-plan")?.length ?? 0) > 0,
      ),
    }),

    // Stage 3: Plan-Driven Deep Research
    makeNode({
      id: "markets",
      stage: "research",
      shape: "ellipse",
      title: "Prediction Markets",
      roleSummary: "Queries Kalshi, Manifold, and Polymarket in parallel, scores relevance (≥5/10), and labels rule differences.",
      upstream: ["evidence-plan"],
      downstream: ["artifact-check-v1"],
      customMetrics: (() => {
        const chars = marketSecs.reduce((a, s) => a + s.chars, 0) ||
          marketNodes.reduce((a, n) => a + (n.output?.chars ?? 0), 0);
        return [
          ...(chars ? [compactChars(chars)] : []),
          ...(marketSourcesCount ? [`${marketSourcesCount} mkt`] : []),
        ];
      })(),
    }),
    makeNode({
      id: "web-search",
      stage: "research",
      shape: "ellipse",
      title: "Web Search",
      badge: extractCycles ? `↻ ${extractCycles}×` : undefined,
      roleSummary: "Generates up to 9 search queries, ranks URLs across buckets, and iterates Fetcher ⇄ LLM Extract (up to 3 cycles).",
      upstream: ["evidence-plan", "asknews"],
      downstream: ["history-builder", "artifact-check-v1"],
      forceStatus: detail.degradedProviders.length && !webNodes.length ? "warn" : undefined,
      customMetrics: (() => {
        const chars = (sectionsByModule.get("web-search") ?? []).reduce((a, s) => a + s.chars, 0) ||
          webNodes.filter((n) => n.stage === "provider").reduce((a, n) => a + (n.output?.chars ?? 0), 0);
        return [
          ...(chars ? [compactChars(chars)] : []),
          ...(webScrapes ? [`${webScrapes} pg`] : extractCycles ? [`${extractCycles} cyc`] : []),
        ];
      })(),
    }),
    makeNode({
      id: "history-builder",
      stage: "research",
      shape: "ellipse",
      title: "History Builder",
      badge: "Agent",
      roleSummary: "Agent loop building code-verified historical precedent & signal track-record tables with exact page quotes.",
      upstream: ["evidence-plan", "web-search"],
      downstream: ["artifact-check-v1"],
    }),

    // Any dynamically discovered future bot modules in Stage 3
    ...dynamicIds.map((dynId) =>
      makeNode({
        id: dynId,
        stage: "research",
        shape: "ellipse",
        title: dynamicTitles.get(dynId) ?? dynId,
        badge: "Module",
        dynamic: true,
        roleSummary: `Dynamically discovered pipeline module (${dynamicTitles.get(dynId)}).`,
        upstream: ["evidence-plan"],
        downstream: ["artifact-check-v1"],
      }),
    ),

    // Stage 4: Verification & Retry Loop
    makeNode({
      id: "artifact-check-v1",
      stage: "verification",
      shape: "ellipse",
      title: hasRetry ? "Artifact Check V1" : "Artifact Check",
      roleSummary: "Audits collected Section List against the Evidence Plan (4× SoCLaaS ensemble) and pools targeted retry queries if key data is missing.",
      upstream: [
        "resolution-source",
        "source-explorer",
        "asknews",
        "public-data",
        "evidence-plan",
        "markets",
        "web-search",
        "history-builder",
        ...dynamicIds,
      ],
      downstream: hasRetry ? ["focus-retry"] : synthesisTargets,
      forceActive: Boolean(ac || (llmByModule.get("artifact-check-v1")?.length ?? 0) > 0 || (lineageByModule.get("artifact-check-v1")?.length ?? 0) > 0),
      forceStatus: hasRetry ? (retryQueriesCount ? "warn" : acStatus) : acStatus,
      customMetrics: [
        ...(ac?.status ? [ac.status] : []),
        ...(retryQueriesCount ? [`${retryQueriesCount} retry q`] : []),
      ],
    }),
    makeNode({
      id: "focus-retry",
      stage: "verification",
      shape: "ellipse",
      title: "Focused Retry",
      badge: hasRetry ? "↻ 1×" : undefined,
      roleSummary: "Targeted single-cycle search & scrape pass executing pooled retry queries from Artifact Check V1.",
      upstream: ["artifact-check-v1"],
      downstream: ["artifact-check-v2"],
      forceActive: hasRetry,
    }),
    makeNode({
      id: "artifact-check-v2",
      stage: "verification",
      shape: "ellipse",
      title: "Artifact Check V2",
      roleSummary: "Reconciles Artifact Check V1 findings with Focused Retry evidence to produce the final evidence status banner.",
      upstream: ["focus-retry"],
      downstream: synthesisTargets,
      forceActive: hasRetry && Boolean(ac || (lineageByModule.get("artifact-check-v2")?.length ?? 0) > 0),
      forceStatus: hasRetry ? acStatus : "skipped",
      customMetrics: hasRetry && ac?.status ? [ac.status] : [],
    }),
  ];

  // Build Section List Packets (#1–#8 from Excalidraw + Retry + Dynamic)
  const CANONICAL_PACKETS: { id: string; slotNumber?: number; label: string; nodeId: string }[] = [
    { id: "pkt:plan", slotNumber: 1, label: "Evidence Plan", nodeId: "evidence-plan" },
    { id: "pkt:research", slotNumber: 2, label: "Web Research", nodeId: "web-search" },
    { id: "pkt:criteria", slotNumber: 3, label: "Criteria Source", nodeId: "resolution-source" },
    { id: "pkt:markets", slotNumber: 4, label: "Markets", nodeId: "markets" },
    { id: "pkt:asknews", slotNumber: 5, label: "AskNews", nodeId: "asknews" },
    { id: "pkt:public-data", slotNumber: 6, label: "Public APIs", nodeId: "public-data" },
    { id: "pkt:explorer", slotNumber: 7, label: "Source Explorer", nodeId: "source-explorer" },
    { id: "pkt:history", slotNumber: 8, label: "History Table", nodeId: "history-builder" },
    ...(hasRetry ? [{ id: "pkt:retry", label: "Focused Retry", nodeId: "focus-retry" }] : []),
    ...dynamicIds.map((dynId) => ({
      id: `pkt:${dynId}`,
      label: dynamicTitles.get(dynId) ?? dynId,
      nodeId: dynId,
    })),
  ];

  const packets: SectionPacket[] = CANONICAL_PACKETS.map((p) => {
    const secs = sectionsByModule.get(p.nodeId) ?? [];
    const lNodes = (lineageByModule.get(p.nodeId) ?? []).filter((n) => n.stage === "provider" || n.stage === "evidence_plan");
    const chars = secs.length
      ? secs.reduce((a, s) => a + s.chars, 0)
      : lNodes.length
        ? lNodes.reduce((a, n) => a + (n.output?.chars ?? 0), 0)
        : null;
    const present = Boolean(secs.length > 0 || (chars != null && chars > 0));
    return {
      id: p.id,
      slotNumber: p.slotNumber,
      label: p.label,
      chars: chars && chars > 0 ? chars : null,
      present,
      sourceNodeId: p.nodeId,
      sections: secs,
    };
  });

  const totalSectionChars = packets.reduce((sum, p) => sum + (p.chars ?? 0), 0);

  // Stage 5: Dual Context Synthesis (Brief Compiler + Raw Research View) → Forecasters → Aggregation
  const briefRunIds = detail.runs.filter((r) => !rawRunIndices.has(r.index)).map((r) => `run:${r.index}`);
  const rawRunIds = detail.runs.filter((r) => rawRunIndices.has(r.index)).map((r) => `run:${r.index}`);

  const compilerNodes = lineageByModule.get("brief-compiler") ?? [];
  const compilerOutChars =
    briefChars ??
    compilerNodes.filter((n) => n.stage === "brief").reduce((m, n) => Math.max(m, n.output?.chars ?? 0), 0);
  const compilerInChars =
    compilerNodes.find((n) => n.stage === "compiler_input")?.output?.chars ??
    (totalSectionChars > 0 ? totalSectionChars : null);

  nodes.push(
    makeNode({
      id: "brief-compiler",
      stage: "synthesis",
      shape: "ellipse",
      title: "Brief Compiler",
      roleSummary: "Precompresses oversized sections and synthesizes the Section List (up to 400k chars) into a structured Compiled Brief.",
      upstream: [acTerminalId],
      downstream: briefRunIds.length ? briefRunIds : ["aggregation"],
      forceActive: hasBriefBranch && (compilerOutChars > 0 || (llmByModule.get("brief-compiler")?.length ?? 0) > 0 || compilerNodes.length > 0),
      customMetrics: [
        ...(compilerInChars && compilerOutChars
          ? [`${compactChars(compilerInChars)} → ${compactChars(compilerOutChars)}`]
          : compilerOutChars
            ? [compactChars(compilerOutChars)]
            : []),
      ],
    }),
  );

  if (hasRawBranch) {
    nodes.push({
      id: "raw-view",
      stage: "synthesis",
      shape: "rect",
      title: "Raw Research View",
      roleSummary: "Passes the uncompiled Section List + Artifact Check banner directly to the heterogeneous raw-view forecaster.",
      status: "pass",
      active: true,
      metrics: totalSectionChars > 0 ? [compactChars(totalSectionChars), "uncompiled"] : ["uncompiled"],
      upstream: [acTerminalId],
      downstream: rawRunIds.length ? rawRunIds : ["aggregation"],
      sections: parsedSections
        .filter((s) => !s.heading.startsWith("Compiled Brief"))
        .map((s) => ({ heading: s.heading, body: s.body, chars: s.body.length })),
      llmCalls: [],
      lineageNodes: [],
      lineageCalls: [],
    });
  }

  // Match forecaster LLM calls to individual runs cleanly
  const remainingForecasterCalls = [...forecasterCalls];
  const takeCallForModel = (model: string): LlmCall[] => {
    const idx = remainingForecasterCalls.findIndex(
      (c) => c.model === model || c.task.toLowerCase().includes(model.toLowerCase()),
    );
    if (idx >= 0) return [remainingForecasterCalls.splice(idx, 1)[0]];
    return [];
  };

  for (const run of detail.runs) {
    const isRaw = rawRunIndices.has(run.index);
    const parentId = isRaw ? "raw-view" : "brief-compiler";
    const rLineage = lineageByRun.get(run.index) ?? [];
    const rCalls = takeCallForModel(run.model);

    let valChip = run.dropped ? "dropped" : "—";
    if (!run.dropped && run.value) {
      if (run.value.kind === "binary") {
        valChip = `${(run.value.p * 100).toFixed(1).replace(/\.0$/, "")}%`;
      } else if (run.value.kind === "mc") {
        const top = Object.entries(run.value.options).sort((a, b) => b[1] - a[1])[0];
        if (top) valChip = `${(top[1] * 100).toFixed(0)}%`;
      } else if (detail.spread?.kind === "distribution") {
        const med = detail.spread.medians.find((m) => m.runIndex === run.index);
        if (med?.value != null) valChip = `p50 ${compactNumberChip(med.value)}`;
        else if (run.value.kind === "mixture") valChip = `${run.value.components.length} comp`;
      }
    }

    nodes.push({
      id: `run:${run.index}`,
      stage: "synthesis",
      shape: "ellipse",
      title: `Run ${run.index} · ${shortModelName(run.model)}`,
      badge: run.shadow ? "Shadow" : isRaw ? "Raw" : "Brief",
      status: run.dropped ? "warn" : !run.valid ? "fail" : "pass",
      active: true,
      metrics: [
        valChip,
        ...(run.weight != null ? [`${Math.round(run.weight * 100)}% w`] : []),
      ],
      upstream: [parentId],
      downstream: run.dropped || run.shadow ? [] : ["aggregation"],
      roleSummary: `Ensemble member #${run.index} (${run.model}) reading ${isRaw ? "uncompiled raw research" : "the compiled brief"}.`,
      sections: [],
      llmCalls: rCalls,
      lineageNodes: rLineage,
      lineageCalls: rLineage.flatMap((n) => callsByNodeId.get(n.id) ?? []),
      runIndex: run.index,
    });
  }

  // Final Aggregation node
  const usedCount = detail.runs.filter((r) => !r.dropped && !r.shadow).length;
  const aggRule = detail.abstained
    ? "Abstained"
    : detail.type === "binary"
      ? detail.tiebreakerUsed
        ? "Tiebreaker"
        : detail.extremised
          ? "Blend + Extremised"
          : "Median / Blend"
      : detail.type === "multiple_choice"
        ? "Mean Blend"
        : "Quantile CDF Blend";

  nodes.push({
    id: "aggregation",
    stage: "synthesis",
    shape: "diamond",
    title: "Final Forecast",
    badge: detail.tiebreakerUsed ? "Tiebreaker" : undefined,
    status: detail.abstained ? "warn" : detail.submitted ? "pass" : "skipped",
    active: !detail.abstained && detail.final != null,
    metrics: [
      aggRule,
      ...(usedCount ? [`${usedCount}/${detail.runs.length} runs`] : []),
    ],
    upstream: detail.runs.filter((r) => !r.dropped && !r.shadow).map((r) => `run:${r.index}`),
    downstream: [],
    roleSummary: "Combines valid ensemble runs into the final Metaculus payload (with tiebreaker & extremising post-processing where applicable).",
    sections: [],
    llmCalls: [...(llmByModule.get("aggregation") ?? []), ...remainingForecasterCalls],
    lineageNodes: [],
    lineageCalls: [],
  });

  // Ensure all upstream/downstream references point only to existing node IDs
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  for (const n of nodes) {
    n.upstream = n.upstream.filter((id) => nodeMap.has(id));
    n.downstream = n.downstream.filter((id) => nodeMap.has(id));
  }

  const systems = buildSystems(detail, parsedSections, lineage);

  return {
    nodes,
    nodeMap,
    packets,
    systems,
    rawRunIndices,
    hasRetry,
    totalSectionChars,
    briefChars: compilerOutChars || null,
  };
}

function compactNumberChip(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1e9) return `${(v / 1e9).toPrecision(3)}B`;
  if (abs >= 1e6) return `${(v / 1e6).toPrecision(3)}M`;
  if (abs >= 1e4) return `${(v / 1e3).toPrecision(3)}k`;
  return String(Number(v.toPrecision(3)));
}

/* ----------------------------------------------------- centralised systems */

function buildSystems(
  detail: ForecastDetail,
  sections: { heading: string; body: string }[],
  lineage?: LineageDoc | null,
): SystemSummary[] {
  // 1. FETCHER
  const fetcherChain = [
    "Cache",
    "Domain Adapters",
    "Firecrawl Scrape",
    "Crawl4AI",
    "Firecrawl (8s JS)",
    "Wayback Snapshot",
  ];
  const fetchCalls = (lineage?.calls ?? []).filter(
    (c) =>
      c.kind === "scrape" ||
      c.kind === "http" ||
      /cache|adapter|firecrawl|crawl4ai|wayback|wikipedia|metaculus/i.test(c.service ?? ""),
  );
  const fetchByService = new Map<string, SystemBreakdownRow>();
  for (const c of fetchCalls) {
    const label = c.service ?? c.kind;
    const row = fetchByService.get(label) ?? { label, count: 0, failed: 0, seconds: 0 };
    row.count++;
    if (c.failed || (c.status_code ?? 0) >= 400) row.failed++;
    row.seconds += c.duration_s ?? 0;
    fetchByService.set(label, row);
  }
  const fetchRows = [...fetchByService.values()].sort((a, b) => b.count - a.count);
  const fetchFailed = fetchCalls.filter((c) => c.failed || (c.status_code ?? 0) >= 400).length;
  const fetchOk = fetchCalls.length - fetchFailed;

  const fetcherSystem: SystemSummary = {
    id: "fetcher",
    title: "Fetcher",
    status: fetchCalls.length === 0 ? "pass" : fetchOk === 0 ? "fail" : fetchFailed > 0 ? "warn" : "pass",
    pill: fetchCalls.length
      ? `${fetchOk}/${fetchCalls.length} ok`
      : sections.length
        ? "Active"
        : "Idle",
    chain: fetcherChain,
    breakdown: fetchRows,
    notes: fetchCalls.length
      ? []
      : ["Per-URL scraper tier telemetry is populated when run_lineage is published for this forecast."],
    lineageCalls: fetchCalls,
    llmCalls: [],
  };

  // 2. SEARCHER
  const searcherChain = ["SerpAPI (primary)", "Tavily (fallback)", "Firecrawl (fallback)"];
  const searchCalls = (lineage?.calls ?? []).filter(
    (c) => c.kind === "search" || /serp|tavily|search/i.test(c.service ?? ""),
  );
  const searchProvidersFromSections = sections
    .filter((s) => /^Provider:.*(?:Search|SerpAPI|Tavily|Firecrawl)/i.test(s.heading))
    .map((s) => s.heading.replace(/^Provider:\s*/i, "").trim());
  const searchLaneLabel = (lineage?.lanes ?? [])
    .find((l) => /tavily|serpapi|firecrawl|web search/i.test(l))
    ?.replace(/\s+Search$/i, "");
  const activeSearchLabel =
    searchCalls[0]?.service ??
    searchProvidersFromSections[0]?.replace(/\s+Search$/i, "") ??
    searchLaneLabel ??
    null;

  const searchByService = new Map<string, SystemBreakdownRow>();
  for (const c of searchCalls) {
    const label = c.service ?? "search";
    const row = searchByService.get(label) ?? { label, count: 0, failed: 0, seconds: 0 };
    row.count++;
    if (c.failed || (c.status_code ?? 0) >= 400) row.failed++;
    row.seconds += c.duration_s ?? 0;
    searchByService.set(label, row);
  }
  for (const dp of detail.degradedProviders) {
    if (!searchByService.has(dp)) {
      searchByService.set(dp, { label: dp, count: 0, failed: 1, seconds: 0, detail: "degraded during run" });
    }
  }

  const searcherSystem: SystemSummary = {
    id: "searcher",
    title: "Searcher",
    status: detail.degradedProviders.length > 0 ? "warn" : "pass",
    pill: detail.degradedProviders.length
      ? activeSearchLabel
        ? `Fallback · ${activeSearchLabel}`
        : "Fallback"
      : activeSearchLabel ?? "Active",
    chain: searcherChain,
    breakdown: [...searchByService.values()],
    notes: detail.degradedProviders.length
      ? [`Degraded search providers bypassed: ${detail.degradedProviders.join(", ")}.`]
      : [],
    lineageCalls: searchCalls,
    llmCalls: detail.llmCalls.filter((c) => /query|rank/i.test(c.task)),
  };

  // 3. SOCLAAS FALLBACKS
  const soclaasChain = [
    "DeepSeek V4.1 Flash",
    "MiniMax M3.1 Flash",
    "GLM 5.3 Flash",
    "Qwen 3.8 27B",
  ];
  const soclaasCalls = detail.llmCalls.filter(
    (c) =>
      c.source === "quota" ||
      /soclaas/i.test(c.endpoint ?? "") ||
      /qwen|deepseek|minimax|glm/i.test(c.model),
  );
  const soclaasByModel = new Map<string, SystemBreakdownRow>();
  for (const c of soclaasCalls) {
    const row = soclaasByModel.get(c.model) ?? {
      label: c.model,
      count: 0,
      failed: 0,
      seconds: 0,
      quotaMicro: 0,
      usd: 0,
    };
    row.count++;
    row.seconds += c.seconds ?? 0;
    row.quotaMicro = (row.quotaMicro ?? 0) + c.quotaMicro;
    row.usd = (row.usd ?? 0) + c.usd;
    soclaasByModel.set(c.model, row);
  }

  const soclaasSystem: SystemSummary = {
    id: "soclaas",
    title: "SoCLaaS",
    status: detail.qwenOutage ? "warn" : "pass",
    pill: detail.qwenOutage
      ? "Degraded"
      : soclaasCalls.length
        ? `${soclaasCalls.length} calls`
        : "Idle",
    chain: soclaasChain,
    breakdown: [...soclaasByModel.values()].sort((a, b) => b.count - a.count),
    notes: detail.qwenOutage ? [`Outage recorded: ${detail.qwenOutage}`] : [],
    lineageCalls: (lineage?.calls ?? []).filter((c) => /soclaas/i.test(c.service ?? "")),
    llmCalls: soclaasCalls,
  };

  return [fetcherSystem, searcherSystem, soclaasSystem];
}
