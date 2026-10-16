"use client";

import { useRef, useState } from "react";
import type { Actions } from "../KotobaView";
import { deckCounts } from "../srs";
import type { Card, Deck, HintLevel, Store } from "../types";
import { Button, inputStyle, JP_FONT, labelStyle, sectionTitle } from "./ui";

const LEVELS = ["JLPT N5", "JLPT N4", "JLPT N3", "JLPT N2", "JLPT N1"];

const STATUS: Record<Card["state"], { label: string; color: string }> = {
  new: { label: "New", color: "var(--k-new)" },
  learning: { label: "Learning", color: "var(--k-learn)" },
  relearning: { label: "Relearning", color: "var(--k-learn)" },
  review: { label: "Review", color: "var(--k-due)" },
};

const th = {
  fontWeight: 500,
  padding: "9px 16px",
  fontSize: 12,
  textTransform: "uppercase" as const,
  letterSpacing: "0.04em",
  color: "var(--text-muted)",
  textAlign: "left" as const,
};
const td = { padding: "10px 16px", borderTop: "1px solid var(--border)", verticalAlign: "middle" as const };

function untilLabel(card: Card, now: number): string {
  if (card.state === "new") return "—";
  const ms = card.due - now;
  if (ms <= 0) return "now";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

export function DeckPage({
  store,
  deck,
  now,
  actions,
  onBack,
  onStudy,
}: {
  store: Store;
  deck: Deck;
  now: number;
  actions: Actions;
  onBack: () => void;
  onStudy: () => void;
}) {
  const [text, setText] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const counts = deckCounts(store, deck, now);
  const cards = store.cards.filter((c) => c.deckId === deck.id).sort((a, b) => b.addedAt - a.addedAt);
  const nothingToStudy = counts.new + counts.learn + counts.due === 0;

  async function add(input: string) {
    if (!input.trim()) return;
    setBusy(true);
    setStatus("Adding… filling in missing readings and meanings.");
    const result = await actions.addWords(deck.id, input);
    setBusy(false);
    setText("");
    const parts = [`Added ${result.added} ${result.added === 1 ? "word" : "words"}.`];
    if (result.skipped) parts.push(`${result.skipped} already in this deck.`);
    if (result.enrichError) parts.push(`Some details could not be filled in (${result.enrichError}); edit them below.`);
    setStatus(parts.join(" "));
  }

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "40px 24px 56px", display: "flex", flexDirection: "column", gap: 32 }}>
      <nav style={{ fontSize: 13, color: "var(--text-faint)", display: "flex", gap: 6 }}>
        <button
          type="button"
          onClick={onBack}
          style={{ padding: 0, border: 0, background: "none", font: "inherit", color: "var(--text-muted)", cursor: "pointer" }}
        >
          Decks
        </button>
        <span aria-hidden="true">/</span>
        <span style={{ color: "var(--text)" }}>{deck.name}</span>
      </nav>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 20,
          padding: "28px 16px",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
        }}
      >
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600 }}>{deck.name}</h1>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 32, textAlign: "center" }}>
          <Stat value={counts.new} label="New" color="var(--k-new)" />
          <Stat value={counts.learn} label="Learning" color="var(--k-learn)" />
          <Stat value={counts.due} label="Due" color="var(--k-due)" />
        </div>
        <Button
          variant="primary"
          onClick={onStudy}
          disabled={nothingToStudy}
          style={{ height: 44, padding: "0 28px" }}
        >
          {cards.length === 0 ? "Add words to start" : nothingToStudy ? "Done for today" : "Study now"}
        </Button>
      </div>

      <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <h2 style={sectionTitle}>Settings</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 16 }}>
          <label style={labelStyle}>
            Deck name
            <input
              value={deck.name}
              onChange={(e) => actions.updateDeck(deck.id, { name: e.target.value })}
              style={inputStyle}
            />
          </label>
          <label style={labelStyle}>
            New cards per day
            <input
              type="number"
              min={0}
              max={999}
              value={deck.newPerDay}
              onChange={(e) =>
                actions.updateDeck(deck.id, { newPerDay: Math.max(0, Math.min(999, Number(e.target.value) || 0)) })
              }
              style={inputStyle}
            />
          </label>
          <label style={labelStyle}>
            Hint shown by default
            <select
              value={deck.defaultHint}
              onChange={(e) => actions.updateDeck(deck.id, { defaultHint: e.target.value as HintLevel })}
              style={inputStyle}
            >
              <option value="none">None</option>
              <option value="meaning">Meaning (small)</option>
              <option value="translation">Translation (big)</option>
            </select>
          </label>
          <label style={labelStyle}>
            Sentence level
            <select
              value={deck.level}
              onChange={(e) => actions.updateDeck(deck.id, { level: e.target.value })}
              style={inputStyle}
            >
              {LEVELS.map((level) => (
                <option key={level}>{level}</option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <h2 style={sectionTitle}>Add words</h2>
        <label style={labelStyle}>
          One per line. Reading and meaning are optional and filled in for you if left out.
          <textarea
            rows={4}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={"歩く\n忘れる, わすれる, to forget"}
            style={{ ...inputStyle, height: "auto", padding: "10px 12px", fontSize: 15, fontFamily: JP_FONT, resize: "vertical" }}
          />
        </label>
        <input
          ref={fileRef}
          type="file"
          accept=".txt,.csv,.tsv,text/plain,text/csv"
          hidden
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) await add(await file.text());
          }}
        />
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "flex-end", gap: 8 }}>
          {status && <span style={{ flex: "1 1 240px", fontSize: 13, color: "var(--text-muted)" }}>{status}</span>}
          <Button onClick={() => fileRef.current?.click()} disabled={busy}>
            Import file
          </Button>
          <Button variant="dark" onClick={() => add(text)} disabled={busy || !text.trim()}>
            Add words
          </Button>
        </div>
      </section>

      {cards.length > 0 && (
        <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <h2 style={sectionTitle}>
            Words <span style={{ fontWeight: 400, color: "var(--text-faint)" }}>{cards.length}</span>
          </h2>
          <div style={{ border: "1px solid var(--border)", borderRadius: "var(--radius)", overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 560 }}>
              <thead>
                <tr style={{ background: "var(--bg-subtle)" }}>
                  <th style={th}>Word</th>
                  <th style={th}>Reading</th>
                  <th style={th}>Meaning</th>
                  <th style={th}>Status</th>
                  <th style={{ ...th, textAlign: "right" }}>Next</th>
                  <th style={{ ...th, width: 1 }}>
                    <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {cards.map((card) =>
                  editing === card.id ? (
                    <EditRow
                      key={card.id}
                      card={card}
                      onSave={(patch) => {
                        actions.updateCard(card.id, patch);
                        setEditing(null);
                      }}
                      onDelete={() => {
                        actions.deleteCard(card.id);
                        setEditing(null);
                      }}
                      onCancel={() => setEditing(null)}
                    />
                  ) : (
                    <tr key={card.id}>
                      <td style={{ ...td, fontSize: 16, fontFamily: JP_FONT }} lang="ja">{card.word}</td>
                      <td style={{ ...td, color: "var(--text-muted)", fontFamily: JP_FONT }} lang="ja">
                        {card.reading || <span style={{ color: "var(--text-faint)" }}>…</span>}
                      </td>
                      <td style={td}>{card.meaning || <span style={{ color: "var(--text-faint)" }}>…</span>}</td>
                      <td style={{ ...td, color: STATUS[card.state].color }}>{STATUS[card.state].label}</td>
                      <td style={{ ...td, textAlign: "right", color: "var(--text-muted)" }}>{untilLabel(card, now)}</td>
                      <td style={{ ...td, padding: "6px 8px" }}>
                        <Button variant="ghost" onClick={() => setEditing(card.id)} style={{ height: 32, padding: "0 10px" }}>
                          Edit
                        </Button>
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <Button
          variant="ghost"
          style={{ color: "var(--danger)" }}
          onClick={() => {
            if (window.confirm(`Delete “${deck.name}” and all ${cards.length} of its words? This cannot be undone.`)) {
              actions.deleteDeck(deck.id);
              onBack();
            }
          }}
        >
          Delete deck
        </Button>
      </div>
    </div>
  );
}

function Stat({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <div>
      <div style={{ fontSize: 26, fontWeight: 600, color: value ? color : "var(--text-faint)", fontVariantNumeric: "tabular-nums" }}>
        {value}
      </div>
      <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{label}</div>
    </div>
  );
}

function EditRow({
  card,
  onSave,
  onDelete,
  onCancel,
}: {
  card: Card;
  onSave: (patch: Partial<Card>) => void;
  onDelete: () => void;
  onCancel: () => void;
}) {
  const [word, setWord] = useState(card.word);
  const [reading, setReading] = useState(card.reading);
  const [meaning, setMeaning] = useState(card.meaning);
  const cell = { ...inputStyle, width: "100%", height: 32 };

  return (
    <tr style={{ background: "var(--bg-subtle)" }}>
      <td style={td}>
        <input aria-label="Word" lang="ja" value={word} onChange={(e) => setWord(e.target.value)} style={cell} />
      </td>
      <td style={td}>
        <input aria-label="Reading" lang="ja" value={reading} onChange={(e) => setReading(e.target.value)} style={cell} />
      </td>
      <td style={td} colSpan={2}>
        <input aria-label="Meaning" value={meaning} onChange={(e) => setMeaning(e.target.value)} style={cell} />
      </td>
      <td style={{ ...td, padding: "6px 8px" }} colSpan={2}>
        <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
          <Button
            variant="dark"
            style={{ height: 32, padding: "0 10px" }}
            disabled={!word.trim()}
            // A changed word invalidates the sentence written for the old one.
            onClick={() =>
              onSave({
                word: word.trim(),
                reading: reading.trim(),
                meaning: meaning.trim(),
                ...(word.trim() !== card.word ? { pending: undefined, recent: [] } : {}),
              })
            }
          >
            Save
          </Button>
          <Button variant="ghost" style={{ height: 32, padding: "0 10px", color: "var(--danger)" }} onClick={onDelete}>
            Delete
          </Button>
          <Button variant="ghost" style={{ height: 32, padding: "0 10px" }} onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </td>
    </tr>
  );
}
