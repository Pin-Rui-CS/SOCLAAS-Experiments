/**
 * A question's files, as downloads for use outside the library.
 *
 * The markdown files are stored gzipped (handoff §4) and handed out
 * DECOMPRESSED, since the point is to open or paste them elsewhere.
 * `trace.tar.gz` goes out byte for byte — it is already an archive.
 * `brief.md` is the Discuss chat's context pack: the whole forecast in one
 * self-contained document, the handiest thing to give another AI.
 *
 * Plain Node compatible (`.ts` imports, no `server-only`).
 */

import { Supabase } from "./supabase.ts";
import { buildContext } from "./context.ts";
import { zip } from "./zip.ts";
import type { FileKey } from "../types.ts";

export const DOWNLOADS = ["brief", "forecast", "research", "runs", "evolution", "audit", "diagnostics", "trace"] as const;
export type DownloadKey = (typeof DOWNLOADS)[number] | "all";

/** Past this the zip would crowd Vercel's ~4.5MB function response limit. */
const ZIP_LIMIT = 4 * 1024 * 1024;

const FILENAMES: Record<(typeof DOWNLOADS)[number], string> = {
  brief: "brief.md",
  forecast: "forecast.json",
  research: "research.md",
  runs: "runs.md",
  evolution: "evolution.md",
  audit: "audit.md",
  diagnostics: "diagnostics.md",
  trace: "trace.tar.gz",
};

const TYPES: Record<(typeof DOWNLOADS)[number], string> = {
  brief: "text/markdown; charset=utf-8",
  forecast: "application/json; charset=utf-8",
  research: "text/markdown; charset=utf-8",
  runs: "text/markdown; charset=utf-8",
  evolution: "text/markdown; charset=utf-8",
  audit: "text/markdown; charset=utf-8",
  diagnostics: "text/markdown; charset=utf-8",
  trace: "application/gzip",
};

type Loaded = { prefix: string; files: Partial<Record<(typeof DOWNLOADS)[number], Uint8Array>> };

const encode = (text: string) => new TextEncoder().encode(text);

/** `Q45412_2026-09-25`: the question and the day the bot ran it. */
function prefixFor(questionId: string, runAt: string | null, runId: string): string {
  return `Q${questionId}_${runAt?.slice(0, 10) ?? runId}`;
}

async function load(db: Supabase, runId: string, questionId: string, only?: (typeof DOWNLOADS)[number]): Promise<Loaded> {
  const ctx = await buildContext(db, runId, questionId);
  const want = (k: (typeof DOWNLOADS)[number]) => !only || only === k;
  const files: Loaded["files"] = {};

  if (want("brief")) files.brief = encode(ctx.markdown + "\n");
  for (const f of ["research", "runs", "evolution", "audit", "diagnostics"] as FileKey[]) {
    const text = ctx.texts[f];
    if (want(f) && text != null) files[f] = encode(text);
  }
  if (want("forecast")) {
    const { rows } = await db.select<{ raw: unknown }>("forecasts", {
      select: "raw",
      run_id: `eq.${runId}`,
      question_id: `eq.${questionId}`,
    });
    if (rows[0]) files.forecast = encode(JSON.stringify(rows[0].raw, null, 2) + "\n");
  }
  if (want("trace")) {
    const bytes = await db.download(`runs/${runId}/${questionId}/trace.tar.gz`);
    if (bytes) files.trace = bytes;
  }
  return { prefix: prefixFor(questionId, ctx.detail.runAt, runId), files };
}

function attachment(body: Uint8Array, filename: string, type: string): Response {
  return new Response(body as BodyInit, {
    headers: {
      "Content-Type": type,
      "Content-Length": String(body.length),
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

export async function download(db: Supabase, runId: string, questionId: string, key: DownloadKey): Promise<Response> {
  if (key !== "all") {
    const { prefix, files } = await load(db, runId, questionId, key);
    const body = files[key];
    if (!body) return Response.json({ error: `${FILENAMES[key]} was not produced for this run` }, { status: 404 });
    return attachment(body, `${prefix}_${FILENAMES[key]}`, TYPES[key]);
  }

  const { prefix, files } = await load(db, runId, questionId);
  const entries = DOWNLOADS.filter((k) => files[k]).map((k) => ({ name: `${prefix}/${FILENAMES[k]}`, data: files[k]! }));
  const total = entries.reduce((n, e) => n + e.data.length, 0);
  if (total > ZIP_LIMIT) {
    return Response.json(
      { error: `These files total ${(total / 1048576).toFixed(1)} MB, too large for one download here. Download them one at a time.` },
      { status: 413 },
    );
  }
  return attachment(zip(entries), `${prefix}.zip`, "application/zip");
}

/** What exists for a question and how big each download will be, for the menu. */
export async function listDownloads(db: Supabase, runId: string, questionId: string) {
  const ctx = await buildContext(db, runId, questionId);
  const [listing, raw] = await Promise.all([
    db.list(`runs/${runId}/${questionId}/`),
    db.select<{ raw: unknown }>("forecasts", { select: "raw", run_id: `eq.${runId}`, question_id: `eq.${questionId}` }),
  ]);
  const traceEntry = listing.find((o) => o.name === "trace.tar.gz");
  const traceSize = Number((traceEntry?.metadata as { size?: number } | null)?.size ?? 0);
  const size = (text: string | null) => (text == null ? null : new TextEncoder().encode(text).length);

  return {
    prefix: prefixFor(questionId, ctx.detail.runAt, runId),
    files: {
      brief: size(ctx.markdown + "\n"),
      // Pretty-printed, as the download serves it.
      forecast: raw.rows[0] ? size(JSON.stringify(raw.rows[0].raw, null, 2) + "\n") : null,
      research: size(ctx.texts.research),
      runs: size(ctx.texts.runs),
      evolution: size(ctx.texts.evolution),
      audit: size(ctx.texts.audit),
      diagnostics: size(ctx.texts.diagnostics),
      trace: traceEntry ? traceSize : null,
    } satisfies Record<(typeof DOWNLOADS)[number], number | null>,
  };
}

