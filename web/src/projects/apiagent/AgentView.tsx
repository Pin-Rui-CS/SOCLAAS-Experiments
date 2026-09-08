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
import { SavedSources, ToolPanel, TurnCostLine } from "./components/ToolPanel";
import { Composer } from "./components/Composer";
import { ModelPicker } from "./components/ModelPicker";
import { canDriveLoop } from "./models";
import type { ModelInfo, TurnCost } from "./types";
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

const MODEL_STORAGE_KEY = "soclaas.apiagent.model";

export default function AgentView() {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [model, setModel] = useState("");
  const [modelError, setModelError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationId, setConversationId] = useState<string>(newConversationId);

  /*
   * The transport is built once, but its body callback has to see the current
   * model — including on `regenerate()`, which is why this cannot simply be
   * passed at sendMessage time.
   */
  const requestRef = useRef({ model });
  useEffect(() => {
    requestRef.current = { model };
  }, [model]);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/projects/apiagent",
        body: () => ({ ...requestRef.current }),
      }),
    [],
  );

  const { messages, setMessages, sendMessage, stop, status, error, regenerate } =
    useChat({ transport });

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

        /*
         * Only tool-capable models, and this is a filter rather than a warning.
         *
         * Chat can fall back to answering without tools. This project cannot:
         * every answer comes through a tool call, so a model that does not emit
         * them would simply answer from memory — the exact behaviour the whole
         * design exists to prevent. The route refuses these too; the client is
         * not the authority, only the convenience.
         */
        const all: ModelInfo[] = body.models ?? [];
        const usable = all.filter((entry) => entry.tools && canDriveLoop(entry.id));
        setModels(usable);

        if (usable.length === 0) {
          setModelError(
            "No model in the catalogue is verified to run this research loop, " +
              "so this project cannot answer anything. See canDriveLoop in " +
              "src/projects/apiagent/models.ts.",
          );
          return;
        }

        const remembered = (() => {
          try {
            return localStorage.getItem(MODEL_STORAGE_KEY);
          } catch {
            return null;
          }
        })();

        // The server's default is chosen across the whole catalogue and may not
        // be tool-capable, so it is only honoured if it survived the filter.
        const preferred =
          remembered && usable.some((m) => m.id === remembered)
            ? remembered
            : usable.some((m) => m.id === body.defaultModel)
              ? body.defaultModel
              : usable[0].id;

        setModel(preferred);
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

  /* --------------------------------------------------------- conversations */

  useEffect(() => setConversations(loadConversations()), []);

  // Persist whenever a turn completes. Reasoning is stripped; retrieval URLs
  // are kept, because they are the audit trail rather than a convenience.
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

  const startNew = useCallback(() => {
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
      if (id === conversationId) startNew();
    },
    [conversationId, startNew],
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
        onNew={startNew}
        onOpen={openConversation}
        onDelete={removeConversation}
      />

      {modelError && <Banner tone="danger">{modelError}</Banner>}

      <MessageList messages={messages} busy={busy} onAsk={setInput} />

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
      <strong style={{ fontSize: 14, marginRight: 2 }}>API Agent</strong>

      <ModelPicker
        models={models}
        value={model}
        onChange={onModelChange}
        disabled={busy}
      />

      <div style={{ flex: 1 }} />

      <button type="button" onClick={onNew} style={headerButton}>
        New question
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
                Nothing saved yet.
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
                    conversation.id === currentId
                      ? "var(--bg-active)"
                      : "transparent",
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

/**
 * Openers that demonstrate the tier distinction rather than just filling space.
 *
 * The first two are the crossref's own worked examples. The third is
 * deliberately a Tier B question: a good answer to it refuses to treat news
 * coverage as settling anything, and that refusal is the clearest single
 * demonstration of what this project is for.
 */
const EXAMPLES = [
  "How many US banks failed between January and August 2026?",
  "Was the sky clear over Reykjavík on 12 August 2026?",
  "Has there been reporting on a Putin–Trump phone call recently?",
];

function MessageList({
  messages,
  busy,
  onAsk,
}: {
  messages: UIMessage[];
  busy: boolean;
  onAsk: (text: string) => void;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);

  // Follow new output only while the reader is already at the bottom, so
  // scrolling up to read isn't fought by the stream.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
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
        <div style={{ textAlign: "center", padding: 24, maxWidth: 520 }}>
          <p style={{ fontSize: 15, color: "var(--text-muted)", margin: 0 }}>
            Ask a question with a checkable answer
          </p>
          <p style={{ fontSize: 13, color: "var(--text-faint)", margin: "6px 0 18px" }}>
            The agent searches a registry of public data APIs, calls the ones
            that fit, and answers from what they returned. Sources are labelled
            by tier: A can settle a question, B is evidence only.
          </p>

          <div style={{ display: "grid", gap: 6 }}>
            {EXAMPLES.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => onAsk(example)}
                style={{
                  border: "1px solid var(--border)",
                  background: "var(--bg-raised)",
                  borderRadius: "var(--radius)",
                  padding: "8px 12px",
                  fontSize: 13,
                  cursor: "pointer",
                  textAlign: "left",
                  color: "var(--text-muted)",
                }}
              >
                {example}
              </button>
            ))}
          </div>
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
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  margin: "0 0 18px",
                }}
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
           * A research turn interleaves: think, look up sources, call two APIs,
           * think again, answer. Joining all the text and all the reasoning
           * would collapse that into a shape the model never produced — and
           * would drop the tool parts entirely, which here means dropping the
           * evidence.
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

              {/* Only once the turn has finished, so the tier summary never
                * flickers mid-stream with a partial tally. */}
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
        Working…
      </span>
      <style>{`@keyframes pulse { 0%,100% { opacity: .45 } 50% { opacity: 1 } }`}</style>
    </div>
  );
}
