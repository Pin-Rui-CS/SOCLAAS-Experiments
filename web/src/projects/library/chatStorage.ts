import { getToolName, isToolUIPart, type UIMessage } from "ai";

/**
 * One Discuss thread per forecast, in this browser's localStorage.
 *
 * The Chat project's rules, for the same reasons (see chat/storage.ts):
 * reasoning is NOT kept — it is the bulk of a reasoning model's output and
 * rarely re-read — and neither is raw tool output; the links a web search or
 * fetch returned ARE kept, as `source-url` parts, because they are the evidence.
 * File reads leave nothing behind: the answer quoting them is what matters,
 * and the file itself is one click away in the Files tab.
 *
 * Every access is wrapped; blocked storage must never stop the panel working.
 */

const KEY = "soclaas.library.chats.v1";
const MAX_THREADS = 40;

type PersistedPart =
  | { type: "text"; text: string }
  | { type: "source-url"; sourceId: string; url: string; title?: string };

type PersistedMessage = { id: string; role: "system" | "user" | "assistant"; parts: PersistedPart[] };

type Thread = { messages: PersistedMessage[]; updatedAt: number };

function readAll(): Record<string, Thread> {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function sourcesOf(tool: string, output: unknown): { url: string; title?: string }[] {
  if (tool === "web_search") {
    const results = (output as { results?: { url?: string; title?: string }[] } | undefined)?.results ?? [];
    return results.flatMap((r) => (r.url ? [{ url: r.url, title: r.title }] : []));
  }
  if (tool === "web_fetch") {
    const page = output as { url?: string; title?: string } | undefined;
    return page?.url ? [{ url: page.url, title: page.title }] : [];
  }
  return [];
}

function strip(messages: UIMessage[]): PersistedMessage[] {
  return messages.map((message) => {
    const parts: PersistedPart[] = [];
    const seen = new Set<string>();
    for (const part of message.parts) {
      if (part.type === "text") parts.push({ type: "text", text: part.text });
      else if (part.type === "source-url") {
        if (!seen.has(part.url)) {
          seen.add(part.url);
          parts.push({ type: "source-url", sourceId: part.url, url: part.url, title: part.title });
        }
      } else if (isToolUIPart(part) && part.state === "output-available") {
        for (const s of sourcesOf(getToolName(part), part.output)) {
          if (seen.has(s.url)) continue;
          seen.add(s.url);
          parts.push({ type: "source-url", sourceId: s.url, url: s.url, title: s.title });
        }
      }
    }
    return { id: message.id, role: message.role, parts };
  });
}

export function loadThread(key: string): UIMessage[] {
  return (readAll()[key]?.messages ?? []) as UIMessage[];
}

/** Save one thread, evicting the oldest threads until the write fits. */
export function saveThread(key: string, messages: UIMessage[]) {
  const all = readAll();
  if (messages.length) all[key] = { messages: strip(messages), updatedAt: Date.now() };
  else delete all[key];

  let keys = Object.keys(all).sort((a, b) => all[b].updatedAt - all[a].updatedAt).slice(0, MAX_THREADS);
  for (;;) {
    try {
      localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(keys.map((k) => [k, all[k]]))));
      return;
    } catch {
      // Full (or blocked): drop the oldest other thread and retry, never the current one.
      const victim = [...keys].reverse().find((k) => k !== key);
      if (!victim) return;
      keys = keys.filter((k) => k !== victim);
    }
  }
}
