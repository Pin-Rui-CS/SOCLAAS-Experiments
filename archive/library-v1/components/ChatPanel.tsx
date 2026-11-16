"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, getToolName, isToolUIPart, type UIMessage } from "ai";
import { CHAT_MODELS, DEFAULT_CHAT_MODEL } from "../models";
import { loadThread, saveThread } from "../chatStorage";
import { Markdown } from "./Markdown";
import { ReasoningPanel, SavedSources, ToolRow, TurnCostLine, type TurnCost } from "./ChatParts";

const MODEL_KEY = "soclaas.library.chatModel";
const WEB_KEY = "soclaas.library.chatWeb";
/** Chat's provider choice, read so both chats spend from the same search account. */
const CHAT_PROVIDER_KEY = "soclaas.chat.searchProvider";
/** The shell's balance chip listens for this; same contract as the Chat project. */
const USAGE_CHANGED_EVENT = "soclaas:usage-changed";

const STARTERS = [
  "Why did the models disagree?",
  "Make the strongest case against the submitted forecast.",
  "What evidence is missing, and would it move the forecast?",
  "Summarise each run's key argument.",
];

function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // per-browser convenience only
  }
}

/**
 * A conversation about the forecast on screen. Mount it with a `key` per
 * forecast: each forecast has its own thread, restored from this browser.
 */
export function ChatPanel({
  runId,
  questionId,
  onClose,
}: {
  runId: string;
  questionId: number;
  onClose: () => void;
}) {
  const threadKey = `${runId}|${questionId}`;
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState<string>(() => stored(MODEL_KEY) ?? DEFAULT_CHAT_MODEL);
  const [webAvailable, setWebAvailable] = useState(false);
  const [web, setWeb] = useState(() => stored(WEB_KEY) === "1");
  const [input, setInput] = useState("");
  const [initial] = useState<UIMessage[]>(() => loadThread(threadKey));

  const transport = useMemo(() => new DefaultChatTransport({ api: "/api/projects/library" }), []);

  // Sent with each request, so a retry uses the model and Web setting chosen now, not at the first try.
  const requestBody = () => ({
    model,
    web: web && webAvailable,
    runId,
    questionId,
    searchProvider: stored(CHAT_PROVIDER_KEY) ?? undefined,
  });

  const { messages, setMessages, sendMessage, stop, status, error, regenerate } = useChat({
    id: threadKey,
    messages: initial,
    transport,
    onFinish: ({ message }) => {
      const meta = message.metadata as TurnCost | undefined;
      if (meta?.credits) {
        window.dispatchEvent(
          new CustomEvent(USAGE_CHANGED_EVENT, { detail: { providerId: meta.searchProviderId, credits: meta.credits } }),
        );
      }
    },
  });
  const busy = status === "submitted" || status === "streaming";

  // Save once a turn settles, not on every streamed token.
  useEffect(() => {
    if (status === "ready") saveThread(threadKey, messages);
  }, [status, messages, threadKey]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/models")
      .then((r) => r.json())
      .then((body) => {
        if (cancelled) return;
        const offered = new Set<string>((body.models ?? []).map((m: { id: string }) => m.id));
        setModels(CHAT_MODELS.filter((m) => offered.has(m)));
        setWebAvailable((body.searchProviders ?? []).length > 0);
      })
      .catch(() => {
        // The picker falls back to the default model; a failed turn will say why.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Follow the conversation as it grows.
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  const send = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setInput("");
    void sendMessage({ text: trimmed }, { body: requestBody() });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send(input);
    }
  };

  const newChat = () => {
    if (busy) stop();
    setMessages([]);
    saveThread(threadKey, []);
  };

  const choices = models.length ? models : [model];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, background: "var(--bg)" }}>
      <div style={{ padding: "12px 14px 10px", borderBottom: "1px solid var(--border)", display: "grid", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <span style={{ fontWeight: 600 }}>Discuss this forecast</span>
          <span style={{ display: "flex", gap: 4 }}>
            <button type="button" onClick={newChat} disabled={!messages.length} style={smallButton} title="Clear this forecast's thread">
              New chat
            </button>
            <button type="button" onClick={onClose} aria-label="Close discussion" title="Close" style={{ ...smallButton, width: 28, padding: 0 }}>
              ✕
            </button>
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12.5 }}>
          <select
            value={model}
            onChange={(e) => {
              setModel(e.target.value);
              store(MODEL_KEY, e.target.value);
            }}
            aria-label="Model"
            style={{ flex: 1, minWidth: 0, padding: "4px 6px", border: "1px solid var(--border)", borderRadius: "var(--radius)", background: "var(--bg)", fontSize: 12.5 }}
          >
            {choices.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          {webAvailable && (
            <label style={{ display: "flex", alignItems: "center", gap: 5, color: "var(--text-muted)", whiteSpace: "nowrap" }} title="Let the model search the web; spends search credits">
              <input
                type="checkbox"
                checked={web}
                onChange={(e) => {
                  setWeb(e.target.checked);
                  store(WEB_KEY, e.target.checked ? "1" : "0");
                }}
              />
              Web
            </label>
          )}
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "14px 14px 6px" }}>
        {messages.length === 0 ? (
          <div>
            <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 10px" }}>
              The model has this forecast&apos;s question, every run&apos;s answer, the evidence check and the research
              brief, and can open any transcript or research file.
            </p>
            <div style={{ display: "grid", gap: 6 }}>
              {STARTERS.map((s) => (
                <button key={s} type="button" onClick={() => send(s)} style={starterButton}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((message, index) => (
            <Message key={message.id} message={message} streaming={busy && index === messages.length - 1 && message.role === "assistant"} />
          ))
        )}
        {busy && messages[messages.length - 1]?.role === "user" && <Waiting />}
        {error && (
          <div style={{ fontSize: 12.5, color: "var(--warn-text)", background: "var(--warn-bg)", border: "1px solid var(--warn-border)", borderRadius: "var(--radius)", padding: "8px 10px", margin: "6px 0" }}>
            {error.message || "The request failed."}{" "}
            <button type="button" onClick={() => void regenerate({ body: requestBody() })} style={{ ...smallButton, marginLeft: 6 }}>
              Retry
            </button>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div style={{ borderTop: "1px solid var(--border)", padding: 10, display: "flex", gap: 8, alignItems: "flex-end" }}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Ask about this forecast…"
          aria-label="Message"
          rows={Math.min(6, Math.max(2, input.split("\n").length))}
          style={{ flex: 1, resize: "none", padding: "7px 9px", border: "1px solid var(--border)", borderRadius: "var(--radius)", background: "var(--bg-raised)", fontSize: 13.5, lineHeight: 1.45 }}
        />
        {busy ? (
          <button type="button" onClick={() => stop()} style={{ ...smallButton, height: 34 }}>
            Stop
          </button>
        ) : (
          <button
            type="button"
            onClick={() => send(input)}
            disabled={!input.trim()}
            style={{ ...smallButton, height: 34, background: "var(--accent)", color: "var(--accent-fg)", borderColor: "var(--accent)", opacity: input.trim() ? 1 : 0.5 }}
          >
            Send
          </button>
        )}
      </div>
    </div>
  );
}

function Message({ message, streaming }: { message: UIMessage; streaming: boolean }) {
  if (message.role === "user") {
    const text = message.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
    return (
      <div style={{ display: "flex", justifyContent: "flex-end", margin: "0 0 14px" }}>
        <div style={{ maxWidth: "88%", background: "var(--accent-subtle)", border: "1px solid var(--border)", borderRadius: 10, padding: "7px 11px", fontSize: 13.5, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
          {text}
        </div>
      </div>
    );
  }

  // In order: a turn interleaves thinking, file reads, searches and text.
  const parts = message.parts.filter((p) => p.type === "text" || p.type === "reasoning" || isToolUIPart(p));
  const sources = message.parts.flatMap((p) => (p.type === "source-url" ? [{ url: p.url, title: p.title }] : []));
  return (
    <div style={{ margin: "0 0 16px", fontSize: 13.5 }}>
      {parts.map((part, i) => {
        const key = `${message.id}:${i}`;
        if (part.type === "reasoning") return <ReasoningPanel key={key} text={part.text} streaming={streaming && i === parts.length - 1} />;
        if (part.type === "text") return <Markdown key={key}>{part.text}</Markdown>;
        if (isToolUIPart(part)) {
          return (
            <ToolRow
              key={key}
              tool={getToolName(part)}
              state={part.state}
              input={part.input}
              output={"output" in part ? part.output : undefined}
              errorText={"errorText" in part ? part.errorText : undefined}
            />
          );
        }
        return null;
      })}
      <SavedSources sources={sources} />
      {!streaming && <TurnCostLine cost={message.metadata as TurnCost | undefined} />}
      {streaming && parts.length === 0 && <Waiting />}
    </div>
  );
}

function Waiting() {
  return (
    <div style={{ color: "var(--text-faint)", fontSize: 12.5, padding: "2px 0 10px" }}>
      <span style={{ animation: "libpulse 1.4s ease-in-out infinite" }}>Waiting for the model…</span>
      <style>{`@keyframes libpulse { 0%,100% { opacity: .45 } 50% { opacity: 1 } }`}</style>
    </div>
  );
}

const smallButton = {
  padding: "3px 9px",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius)",
  background: "transparent",
  cursor: "pointer",
  fontSize: 12.5,
} as const;

const starterButton = {
  textAlign: "left",
  padding: "8px 11px",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius)",
  background: "var(--bg-subtle)",
  cursor: "pointer",
  fontSize: 13,
  color: "var(--text)",
} as const;
