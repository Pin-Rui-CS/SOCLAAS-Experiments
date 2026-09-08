import { getToolName, isToolUIPart, type UIMessage } from "ai";

/**
 * Conversation persistence in localStorage.
 *
 * Adapted from `projects/chat/storage.ts`; the reasoning there applies here
 * unchanged and is worth restating, because both halves matter more in this
 * project than in that one.
 *
 * Reasoning is NOT persisted. A single block measured 30,279 characters against
 * a ~5MB budget stored as UTF-16, and it is the least re-read content — useful
 * while you watch it, rarely afterwards.
 *
 * The retrieval URLs ARE persisted. In chat that was about being able to check
 * an answer's sources; here it is a requirement. §3 of `api-registry-crossref.md`
 * says a result must be logged with its retrieval URL and timestamp, and a log
 * that vanishes on reload is not a log. An answer that survives a reload still
 * reading as grounded, with nothing behind it, is worse than one that never
 * cited anything.
 *
 * They are stored as `source-url` parts, which is a real UIMessage part type.
 * That matters because a reopened conversation is sent back to the model on the
 * next turn: `convertToModelMessages` filters parts through an allowlist and
 * skips these, so they round-trip without reaching its unsupported-part throw.
 * A custom part type here would break the next turn of every reopened
 * conversation.
 *
 * Every access is wrapped: private windows, cleared site data and browsers
 * configured to block storage all throw here, and none of them should stop the
 * page rendering.
 */

const KEY = "soclaas.apiagent.conversations.v1";
const MAX_CONVERSATIONS = 50;

export type PersistedPart =
  | { type: "text"; text: string }
  | { type: "source-url"; sourceId: string; url: string; title?: string };

export type PersistedMessage = {
  id: string;
  role: "system" | "user" | "assistant";
  parts: PersistedPart[];
};

export type Conversation = {
  id: string;
  title: string;
  model: string;
  updatedAt: number;
  messages: PersistedMessage[];
};

/**
 * The provenance a completed call produced.
 *
 * Only `call_api` yields one — `find_apis` touches no network and produces no
 * evidence, just a shortlist. The tier travels in the title so a reopened
 * conversation still distinguishes a resolution-grade source from an input.
 */
function sourcesOf(
  tool: string,
  output: unknown,
): Array<{ url: string; title?: string }> {
  if (tool !== "call_api") return [];

  const result = output as
    | { url?: string; name?: string; tier?: string; error?: string }
    | undefined;

  if (!result?.url || result.error) return [];

  return [
    {
      url: result.url,
      title: result.name
        ? `${result.name}${result.tier ? ` (Tier ${result.tier})` : ""}`
        : undefined,
    },
  ];
}

/** Keep text and the retrieval URLs; drop reasoning and the raw rows. */
export function stripForStorage(messages: UIMessage[]): PersistedMessage[] {
  return messages.map((message) => {
    const parts: PersistedPart[] = [];
    const seen = new Set<string>();

    for (const part of message.parts) {
      if (part.type === "text") {
        parts.push({ type: "text", text: part.text });
        continue;
      }

      // Only settled calls have anything worth keeping.
      if (!isToolUIPart(part) || part.state !== "output-available") continue;

      for (const source of sourcesOf(getToolName(part), part.output)) {
        if (seen.has(source.url)) continue;
        seen.add(source.url);
        parts.push({
          type: "source-url",
          sourceId: source.url,
          url: source.url,
          title: source.title,
        });
      }
    }

    return { id: message.id, role: message.role, parts };
  });
}

export function toUIMessages(messages: PersistedMessage[]): UIMessage[] {
  return messages.map((message) => ({
    id: message.id,
    role: message.role,
    parts: message.parts,
  })) as UIMessage[];
}

export function titleFrom(messages: PersistedMessage[]): string {
  const firstUser = messages.find((m) => m.role === "user");
  const text =
    firstUser?.parts
      .flatMap((p) => (p.type === "text" ? [p.text] : []))
      .join(" ")
      .trim() ?? "";
  if (!text) return "New question";
  return text.length > 48 ? `${text.slice(0, 48).trimEnd()}…` : text;
}

export function loadConversations(): Conversation[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return (parsed as Conversation[]).sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

function write(conversations: Conversation[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(conversations));
    return true;
  } catch {
    return false;
  }
}

/**
 * Persist one conversation, evicting the oldest until it fits.
 *
 * A failed write must never lose the conversation you are currently in, so
 * eviction always keeps the one being saved.
 */
export function saveConversation(conversation: Conversation): Conversation[] {
  let all = loadConversations().filter((c) => c.id !== conversation.id);
  all.unshift(conversation);
  all.sort((a, b) => b.updatedAt - a.updatedAt);
  all = all.slice(0, MAX_CONVERSATIONS);

  while (!write(all) && all.length > 1) {
    all.pop(); // drop the oldest and try again
  }

  return all;
}

export function deleteConversation(id: string): Conversation[] {
  const remaining = loadConversations().filter((c) => c.id !== id);
  write(remaining);
  return remaining;
}

export function newConversationId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `c_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }
}
