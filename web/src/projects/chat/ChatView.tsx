"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  getToolName,
  isToolUIPart,
  type UIMessage,
} from "ai";
import { Markdown } from "./components/Markdown";
import { ReasoningPanel } from "./components/ReasoningPanel";
import {
  SavedSources,
  ToolPanel,
  TurnCostLine,
  type TurnCost,
} from "./components/ToolPanel";
import { Composer } from "./components/Composer";
import { ModelPicker } from "./components/ModelPicker";
import type { ModelInfo } from "./types";
import {
  type Conversation,
  deleteConversation,
  loadConversations,
  newConversationId,
  saveConversation,
  stripForStorage,
  titleFrom,
  toUIMessages,
} from "./storage";

const MODEL_STORAGE_KEY = "soclaas.chat.model";
const WEB_STORAGE_KEY = "soclaas.chat.web";
const SEARCH_PROVIDER_STORAGE_KEY = "soclaas.chat.searchProvider";

/**
 * Announces a provider change to the rest of the shell.
 *
 * The sidebar's quota chip has to follow this selection, and it lives outside
 * this project's tree — projects never import each other, and a shared context
 * for one string would be more machinery than it deserves. A window event plus
 * localStorage keeps both in step without either knowing about the other.
 */
export const SEARCH_PROVIDER_EVENT = "soclaas:search-provider";

/** Fired when a turn spends search credits, so the sidebar balance refreshes. */
export const USAGE_CHANGED_EVENT = "soclaas:usage-changed";

export default function ChatView() {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [model, setModel] = useState("");
  const [modelError, setModelError] = useState<string | null>(null);
  const [searchProviders, setSearchProviders] = useState<
    Array<{ id: string; name: string }>
  >([]);
  const [searchProviderId, setSearchProviderId] = useState("");
  const [web, setWeb] = useState(false);
  const [input, setInput] = useState("");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationId, setConversationId] = useState<string>(newConversationId);

  /*
   * The transport is built once, but its body callback has to see current
   * values — including on `regenerate()`, which is why this cannot simply be
   * passed at sendMessage time.
   *
   * Written in an effect rather than during render: the callback only ever runs
   * from a request, which is always after the commit, and assigning during
   * render is the pattern React warns about.
   */
  const requestRef = useRef({ model, web, searchProvider: searchProviderId });
  useEffect(() => {
    requestRef.current = { model, web, searchProvider: searchProviderId };
  }, [model, web, searchProviderId]);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/projects/chat",
        body: () => ({ ...requestRef.current }),
      }),
    [],
  );

  const { messages, setMessages, sendMessage, stop, status, error, regenerate } =
    useChat({
      transport,
      /*
       * Tell the sidebar to re-read the balance, but only when the turn
       * actually spent something.
       *
       * Firing on every message would put a needless request behind each
       * ordinary reply; firing on none would leave the one number that is
       * supposed to be running out as stale as the last page load.
       */
      onFinish: ({ message }) => {
        const meta = message.metadata as TurnCost | undefined;
        const spent = meta?.credits ?? 0;
        if (spent === 0) return;

        // The count travels with the event because the provider's own usage
        // endpoint lags — Tavily was still reporting a pre-search figure two
        // minutes later. The sidebar adds this immediately and lets the server
        // figure catch up behind it.
        window.dispatchEvent(
          new CustomEvent(USAGE_CHANGED_EVENT, {
            detail: { providerId: meta?.searchProviderId, credits: spent },
          }),
        );
      },
    });

  const busy = status === "submitted" || status === "streaming";

  /* ---------------------------------------------------------------- models */

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const response = await fetch("/api/models");
        const body = await response.json();
        if (cancelled) return;

        if (!response.ok) {
          setModelError(body.error ?? "Could not load models.");
          return;
        }

        setModels(body.models ?? []);

        const providers: Array<{ id: string; name: string }> =
          body.searchProviders ?? [];
        setSearchProviders(providers);

        const remembered = (() => {
          try {
            return localStorage.getItem(MODEL_STORAGE_KEY);
          } catch {
            return null;
          }
        })();

        const available: ModelInfo[] = body.models ?? [];
        setModel(
          remembered && available.some((m) => m.id === remembered)
            ? remembered
            : (body.defaultModel ?? available[0]?.id ?? ""),
        );

        // Only restore the web preference if the server still has a provider;
        // otherwise a stored `true` would show as on and silently do nothing.
        if (providers.length > 0) {
          try {
            setWeb(localStorage.getItem(WEB_STORAGE_KEY) === "1");

            // A remembered provider whose key has since been removed must not
            // stick: fall back to the server's first, which is what the route
            // would use anyway.
            const storedProvider = localStorage.getItem(SEARCH_PROVIDER_STORAGE_KEY);
            setSearchProviderId(
              storedProvider && providers.some((p) => p.id === storedProvider)
                ? storedProvider
                : providers[0].id,
            );
          } catch {
            setSearchProviderId(providers[0].id);
          }
        }
      } catch {
        if (!cancelled) setModelError("Could not reach the server.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const chooseModel = useCallback((next: string) => {
    setModel(next);
    try {
      localStorage.setItem(MODEL_STORAGE_KEY, next);
    } catch {
      /* storage blocked; the choice just won't be remembered */
    }
  }, []);

  const chooseWeb = useCallback((next: boolean) => {
    setWeb(next);
    try {
      localStorage.setItem(WEB_STORAGE_KEY, next ? "1" : "0");
    } catch {
      /* storage blocked; the choice just won't be remembered */
    }
  }, []);

  const chooseSearchProvider = useCallback((next: string) => {
    setSearchProviderId(next);
    try {
      localStorage.setItem(SEARCH_PROVIDER_STORAGE_KEY, next);
    } catch {
      /* storage blocked; the choice just won't be remembered */
    }
    // Tell the sidebar chip to show this provider's quota instead.
    window.dispatchEvent(new CustomEvent(SEARCH_PROVIDER_EVENT, { detail: next }));
  }, []);

  /* --------------------------------------------------------- conversations */

  useEffect(() => setConversations(loadConversations()), []);

  // Persist whenever a turn completes. Reasoning is stripped on the way out.
  useEffect(() => {
    if (busy || messages.length === 0) return;

    const persisted = stripForStorage(messages);
    if (persisted.every((m) => m.parts.length === 0)) return;

    setConversations(
      saveConversation({
        id: conversationId,
        title: titleFrom(persisted),
        model,
        updatedAt: Date.now(),
        messages: persisted,
      }),
    );
  }, [busy, messages, conversationId, model]);

  const startNewChat = useCallback(() => {
    stop();
    setConversationId(newConversationId());
    setMessages([]);
    setInput("");
  }, [setMessages, stop]);

  const openConversation = useCallback(
    (conversation: Conversation) => {
      stop();
      setConversationId(conversation.id);
      setMessages(toUIMessages(conversation.messages));
      setInput("");
    },
    [setMessages, stop],
  );

  const removeConversation = useCallback(
    (id: string) => {
      const remaining = deleteConversation(id);
      setConversations(remaining);
      if (id === conversationId) startNewChat();
    },
    [conversationId, startNewChat],
  );

  /* ------------------------------------------------------------- submitting */

  const submit = useCallback(() => {
    const text = input.trim();
    if (!text || !model) return;
    setInput("");
    void sendMessage({ text });
  }, [input, model, sendMessage]);

  /* ------------------------------------------------------------------- view */

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <Header
        model={model}
        models={models}
        onModelChange={chooseModel}
        busy={busy}
        conversations={conversations}
        currentId={conversationId}
        onNew={startNewChat}
        onOpen={openConversation}
        onDelete={removeConversation}
      />

      {modelError && (
        <Banner tone="danger">
          {modelError} The gateway may be unreachable from here.
        </Banner>
      )}

      <MessageList messages={messages} busy={busy} />

      {error && (
        <Banner tone="danger">
          {error.message}{" "}
          <button
            type="button"
            onClick={() => void regenerate()}
            style={{
              background: "none",
              border: "none",
              padding: 0,
              color: "inherit",
              textDecoration: "underline",
              cursor: "pointer",
            }}
          >
            Retry
          </button>
        </Banner>
      )}

      <Composer
        value={input}
        onChange={setInput}
        onSubmit={submit}
        onStop={stop}
        busy={busy}
        disabled={!model && !modelError}
        web={web}
        onWebChange={chooseWeb}
        webProviders={searchProviders}
        webProvider={searchProviderId}
        onWebProviderChange={chooseSearchProvider}
        webSupported={models.find((m) => m.id === model)?.tools ?? false}
      />
    </div>
  );
}

/* ========================================================================== */

function Header({
  model,
  models,
  onModelChange,
  busy,
  conversations,
  currentId,
  onNew,
  onOpen,
  onDelete,
}: {
  model: string;
  models: ModelInfo[];
  onModelChange: (m: string) => void;
  busy: boolean;
  conversations: Conversation[];
  currentId: string;
  onNew: () => void;
  onOpen: (c: Conversation) => void;
  onDelete: (id: string) => void;
}) {
  const [historyOpen, setHistoryOpen] = useState(false);

  return (
    <div
      style={{
        borderBottom: "1px solid var(--border)",
        padding: "10px 16px",
        display: "flex",
        alignItems: "center",
        gap: 10,
        flexShrink: 0,
        position: "relative",
        flexWrap: "wrap",
      }}
    >
      <strong style={{ fontSize: 14, marginRight: 2 }}>Chat</strong>

      <ModelPicker
        models={models}
        value={model}
        onChange={onModelChange}
        disabled={busy}
      />

      <div style={{ flex: 1 }} />

      <button type="button" onClick={onNew} style={headerButton}>
        New chat
      </button>

      <button
        type="button"
        onClick={() => setHistoryOpen((v) => !v)}
        style={headerButton}
        aria-expanded={historyOpen}
      >
        History ({conversations.length})
      </button>

      {historyOpen && (
        <>
          <div
            onClick={() => setHistoryOpen(false)}
            style={{ position: "fixed", inset: 0, zIndex: 20 }}
          />
          <div
            style={{
              position: "absolute",
              top: "100%",
              right: 12,
              zIndex: 30,
              width: 300,
              maxHeight: 380,
              overflowY: "auto",
              background: "var(--bg-raised)",
              border: "1px solid var(--border)",
              borderRadius: 10,
              boxShadow: "0 8px 28px rgba(0,0,0,0.16)",
              padding: 6,
            }}
          >
            {conversations.length === 0 && (
              <p
                style={{
                  color: "var(--text-faint)",
                  fontSize: 13,
                  padding: "10px 8px",
                  margin: 0,
                }}
              >
                No saved conversations yet.
              </p>
            )}

            {conversations.map((conversation) => (
              <div
                key={conversation.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  borderRadius: 6,
                  background:
                    conversation.id === currentId ? "var(--bg-active)" : "transparent",
                }}
              >
                <button
                  type="button"
                  onClick={() => {
                    onOpen(conversation);
                    setHistoryOpen(false);
                  }}
                  style={{
                    flex: 1,
                    textAlign: "left",
                    background: "none",
                    border: "none",
                    padding: "7px 8px",
                    cursor: "pointer",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    fontSize: 13,
                  }}
                >
                  {conversation.title}
                </button>
                <button
                  type="button"
                  aria-label={`Delete ${conversation.title}`}
                  onClick={() => onDelete(conversation.id)}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "var(--text-faint)",
                    padding: "0 8px",
                    fontSize: 15,
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const headerButton: React.CSSProperties = {
  border: "1px solid var(--border)",
  background: "var(--bg-raised)",
  borderRadius: "var(--radius)",
  padding: "5px 10px",
  fontSize: 13,
  cursor: "pointer",
};

function Banner({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "danger" | "warn";
}) {
  return (
    <div
      style={{
        margin: "10px 16px 0",
        padding: "8px 12px",
        borderRadius: "var(--radius)",
        fontSize: 13,
        background: tone === "danger" ? "var(--accent-subtle)" : "var(--warn-bg)",
        border: `1px solid ${tone === "danger" ? "var(--border)" : "var(--warn-border)"}`,
        color: tone === "danger" ? "var(--danger)" : "var(--warn-text)",
      }}
    >
      {children}
    </div>
  );
}

function MessageList({ messages, busy }: { messages: UIMessage[]; busy: boolean }) {
  const endRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);

  // Follow new output only while the reader is already at the bottom, so
  // scrolling up to read isn't fought by the stream.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      pinnedRef.current =
        el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    };
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (pinnedRef.current) endRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div
        ref={scrollRef}
        style={{ flex: 1, overflowY: "auto", display: "grid", placeItems: "center" }}
      >
        <div style={{ textAlign: "center", color: "var(--text-faint)", padding: 24 }}>
          <p style={{ fontSize: 15, color: "var(--text-muted)", margin: 0 }}>
            Start a conversation
          </p>
          <p style={{ fontSize: 13, marginTop: 6 }}>
            Reasoning models show their thinking as it streams.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div ref={scrollRef} style={{ flex: 1, overflowY: "auto" }}>
      <div style={{ maxWidth: 780, margin: "0 auto", padding: "20px 16px 8px" }}>
        {messages.map((message, index) => {
          const isLast = index === messages.length - 1;
          const streaming = busy && isLast && message.role === "assistant";

          if (message.role === "user") {
            return (
              <div
                key={message.id}
                style={{ display: "flex", justifyContent: "flex-end", margin: "0 0 18px" }}
              >
                <div
                  style={{
                    maxWidth: "82%",
                    background: "var(--accent-subtle)",
                    border: "1px solid var(--border)",
                    borderRadius: 12,
                    padding: "9px 13px",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                >
                  {message.parts
                    .filter((p) => p.type === "text")
                    .map((p) => (p as { text: string }).text)
                    .join("")}
                </div>
              </div>
            );
          }

          /*
           * Rendered in ORDER, not sorted into buckets.
           *
           * A turn with tools interleaves: think, search, read, think, answer.
           * Joining all the text and all the reasoning would collapse that into
           * a shape the model never produced — and would drop tool parts on the
           * floor entirely, leaving a blank message for the whole search.
           */
          const renderable = message.parts.filter(
            (part) =>
              part.type === "text" ||
              part.type === "reasoning" ||
              isToolUIPart(part),
          );

          return (
            <div key={message.id} style={{ margin: "0 0 22px" }}>
              {renderable.map((part, partIndex) => {
                const key = `${message.id}:${partIndex}`;
                const isLastPart = partIndex === renderable.length - 1;

                if (part.type === "reasoning") {
                  return (
                    <ReasoningPanel
                      key={key}
                      text={part.text}
                      streaming={streaming && isLastPart}
                    />
                  );
                }

                if (part.type === "text") {
                  return <Markdown key={key}>{part.text}</Markdown>;
                }

                return (
                  <ToolPanel
                    key={key}
                    tool={getToolName(part)}
                    state={part.state}
                    input={part.input}
                    output={"output" in part ? part.output : undefined}
                    errorText={"errorText" in part ? part.errorText : undefined}
                  />
                );
              })}

              {/* Only present on a reopened conversation; live turns show
                * ToolPanel above instead. */}
              <SavedSources
                sources={message.parts.flatMap((part) =>
                  part.type === "source-url"
                    ? [{ url: part.url, title: part.title }]
                    : [],
                )}
              />

              {/* Only present once the turn has finished, so it never flickers
                * in mid-stream with a partial count. */}
              {!streaming && (
                <TurnCostLine cost={message.metadata as TurnCost | undefined} />
              )}

              {renderable.length === 0 && streaming && <Waiting />}
            </div>
          );
        })}

        {busy && messages[messages.length - 1]?.role === "user" && <Waiting />}
        <div ref={endRef} />
      </div>
    </div>
  );
}

function Waiting() {
  return (
    <div style={{ color: "var(--text-faint)", fontSize: 13, padding: "2px 0" }}>
      <span style={{ animation: "pulse 1.4s ease-in-out infinite" }}>
        Waiting for the model…
      </span>
      <style>{`@keyframes pulse { 0%,100% { opacity: .45 } 50% { opacity: 1 } }`}</style>
    </div>
  );
}
