import type { UIMessage } from "ai";

/**
 * Conversation persistence in localStorage.
 *
 * Reasoning is deliberately NOT persisted. A single reasoning block measured
 * 30,279 characters against a ~5MB budget that localStorage stores as UTF-16,
 * so roughly 80 such responses would exhaust it. It is also the least re-read
 * content — useful while you watch it, rarely afterwards. It stays in memory
 * for the session and disappears on reload, which is a deliberate trade rather
 * than an oversight.
 *
 * Every access is wrapped: private windows, cleared site data, and browsers
 * configured to block storage all throw here, and none of them should stop the
 * page rendering.
 */

const KEY = "soclaas.chat.conversations.v1";
const MAX_CONVERSATIONS = 50;

export type PersistedPart = { type: "text"; text: string };

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

/** Drop everything that isn't durable text — reasoning above all. */
export function stripForStorage(messages: UIMessage[]): PersistedMessage[] {
  return messages.map((message) => ({
    id: message.id,
    role: message.role,
    parts: message.parts
      .filter((part): part is { type: "text"; text: string } => part.type === "text")
      .map((part) => ({ type: "text" as const, text: part.text })),
  }));
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
  const text = firstUser?.parts.map((p) => p.text).join(" ").trim() ?? "";
  if (!text) return "New chat";
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
