import "server-only";
import { Supabase, SupabaseError } from "./supabase.ts";
import { getFile, getForecast, getLive, getTournaments, listLibrary, validKey } from "./library.ts";
import type { FileKey } from "../types.ts";
import { DOWNLOADS, download, listDownloads, type DownloadKey } from "./download.ts";
import { chat } from "./chat.ts";

/**
 * The forecast library reader's one endpoint. Read-only, GET, dispatched on
 * `view`:
 *
 *   ?view=list
 *   ?view=forecast&run=<run_id>&q=<question_id>
 *   ?view=file&run=…&q=…&file=research|runs|audit|evolution
 *   ?view=live&post=<post_id>
 *   ?view=tournaments&post=<post_id>   (rows that predate raw.tournaments)
 *   ?view=downloads&run=…&q=…           (what can be downloaded, with sizes)
 *   ?view=download&run=…&q=…&file=brief|forecast|research|runs|evolution|audit|trace|all
 *
 * POST is the Discuss chat (chat.ts): a streamed conversation about one forecast.
 *
 * Credentials are this project's own and server-side only. The site signs in
 * to Supabase as the library's owner — FORECAST-LIBRARY-HANDOFF.md §1's
 * preferred path — so row-level security stays in force. The service key is
 * deliberately NOT accepted here: the handoff forbids it in this repo.
 */

function env(name: string): string | undefined {
  return process.env[name] || undefined;
}

let client: Supabase | null = null;

function db(): Supabase {
  const url = env("SUPABASE_URL");
  const anonKey = env("SUPABASE_ANON_KEY");
  const email = env("SUPABASE_READER_EMAIL");
  const password = env("SUPABASE_READER_PASSWORD");
  if (!url || !anonKey || !email || !password) {
    throw new ConfigError(
      "The forecast library is not configured. Set SUPABASE_URL, SUPABASE_ANON_KEY, " +
        "SUPABASE_READER_EMAIL and SUPABASE_READER_PASSWORD.",
    );
  }
  // Reused across requests on a warm instance, which keeps the session token.
  client ??= new Supabase({ kind: "user", url, anonKey, email, password });
  return client;
}

class ConfigError extends Error {}

const FILES: FileKey[] = ["research", "runs", "audit", "evolution"];

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const view = params.get("view");

  try {
    if (view === "list") return json({ items: await listLibrary(db()) });

    if (view === "download" || view === "downloads") {
      const run = params.get("run");
      const q = params.get("q");
      if (!validKey(run, q)) return json({ error: "bad run or question id" }, 400);
      if (view === "downloads") return json(await listDownloads(db(), run!, q!));
      const file = params.get("file") as DownloadKey;
      if (file !== "all" && !(DOWNLOADS as readonly string[]).includes(file)) {
        return json({ error: "unknown file" }, 400);
      }
      return await download(db(), run!, q!, file);
    }

    if (view === "forecast" || view === "file") {
      const run = params.get("run");
      const q = params.get("q");
      if (!validKey(run, q)) return json({ error: "bad run or question id" }, 400);

      if (view === "forecast") {
        const detail = await getForecast(db(), run!, q!);
        return detail ? json(detail) : json({ error: "not found" }, 404);
      }

      const file = params.get("file") as FileKey;
      if (!FILES.includes(file)) return json({ error: "unknown file" }, 400);
      // A missing file is "not produced" (§4), which is a normal answer, not a 404.
      return json({ text: await getFile(db(), run!, q!, file) });
    }

    if (view === "live" || view === "tournaments") {
      const post = Number(params.get("post"));
      if (!Number.isInteger(post) || post <= 0) return json({ error: "bad post id" }, 400);
      const token = env("METACULUS_TOKEN");
      if (!token) {
        return json({ error: "Set METACULUS_TOKEN to fetch live data — Metaculus refuses anonymous reads." }, 503);
      }
      return view === "live"
        ? json(await getLive(token, post))
        : json({ competitions: await getTournaments(token, post) });
    }

    return json({ error: "unknown view" }, 400);
  } catch (error) {
    if (error instanceof ConfigError) return json({ error: error.message, unconfigured: true }, 503);
    // §1: a free project pauses when idle; say so rather than a bare 5xx.
    const paused =
      error instanceof TypeError ||
      (error instanceof SupabaseError && [502, 503, 540, 544].includes(error.status));
    const message = error instanceof Error ? error.message : String(error);
    return json(
      {
        error: paused
          ? `Could not reach the library (${message}). Free Supabase projects pause when idle — check the dashboard.`
          : message,
      },
      502,
    );
  }
}

export async function POST(request: Request) {
  try {
    return await chat(request, db);
  } catch (error) {
    if (error instanceof ConfigError) return json({ error: error.message, unconfigured: true }, 503);
    return json({ error: error instanceof Error ? error.message : String(error) }, 502);
  }
}
