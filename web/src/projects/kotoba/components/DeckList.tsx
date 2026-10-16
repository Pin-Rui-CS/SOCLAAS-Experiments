"use client";

import { useRef, useState } from "react";
import type { Actions } from "../KotobaView";
import { deckCounts, studyDay } from "../srs";
import { exportStore, parseBackup } from "../storage";
import type { Store } from "../types";
import { Button, Count, downloadText, inputStyle } from "./ui";

const th = {
  fontWeight: 500,
  padding: "10px 16px",
  fontSize: 12,
  textTransform: "uppercase" as const,
  letterSpacing: "0.04em",
  color: "var(--text-muted)",
};
const td = { padding: "14px 16px", borderTop: "1px solid var(--border)" };

export function DeckList({
  store,
  now,
  actions,
  onOpen,
}: {
  store: Store;
  now: number;
  actions: Actions;
  onOpen: (deckId: string) => void;
}) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const restoreRef = useRef<HTMLInputElement>(null);
  const studied = store.today.day === studyDay(now) ? store.today.studied : 0;

  function create() {
    const id = actions.createDeck(name);
    setNaming(false);
    setName("");
    onOpen(id);
  }

  /** A word-list file becomes a new deck named after the file. */
  async function importList(file: File) {
    const id = actions.createDeck(file.name.replace(/\.[^.]+$/, ""));
    const result = await actions.addWords(id, await file.text());
    setMessage(
      `Imported ${result.added} words into “${file.name}”.` +
        (result.enrichError ? ` Some readings and meanings could not be filled in: ${result.enrichError}` : ""),
    );
  }

  async function restoreBackup(file: File) {
    try {
      const backup = parseBackup(await file.text());
      const ok = window.confirm(
        `Replace everything here with this backup (${backup.decks.length} decks, ${backup.cards.length} words)?`,
      );
      if (!ok) return;
      actions.restore(backup);
      setMessage("Backup restored.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not read that backup.");
    }
  }

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "56px 24px", display: "flex", flexDirection: "column", gap: 28 }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600, letterSpacing: "-0.01em" }}>Decks</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <Button onClick={() => importRef.current?.click()} title="A .txt or .csv word list, one word per line">
            Import
          </Button>
          <Button variant="primary" onClick={() => setNaming(true)}>
            New deck
          </Button>
        </div>
      </div>

      <input
        ref={importRef}
        type="file"
        accept=".txt,.csv,.tsv,text/plain,text/csv"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void importList(file);
        }}
      />
      <input
        ref={restoreRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void restoreBackup(file);
        }}
      />

      {naming && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            create();
          }}
          style={{ display: "flex", gap: 8 }}
        >
          <label htmlFor="kotoba-deck-name" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
            Deck name
          </label>
          <input
            id="kotoba-deck-name"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Deck name"
            style={{ ...inputStyle, flex: 1 }}
          />
          <Button variant="dark" type="submit">
            Create
          </Button>
          <Button variant="ghost" onClick={() => setNaming(false)}>
            Cancel
          </Button>
        </form>
      )}

      {message && <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted)" }}>{message}</p>}

      {store.decks.length === 0 ? (
        <div
          style={{
            border: "1px dashed var(--border-strong)",
            borderRadius: "var(--radius)",
            padding: "40px 24px",
            textAlign: "center",
            color: "var(--text-muted)",
          }}
        >
          No decks yet. Create one, then paste in the words you are learning.
        </div>
      ) : (
        <div style={{ border: "1px solid var(--border)", borderRadius: "var(--radius)", overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 420 }}>
            <thead>
              <tr style={{ background: "var(--bg-subtle)" }}>
                <th style={{ ...th, textAlign: "left" }}>Deck</th>
                <th style={{ ...th, textAlign: "right", width: 72 }}>New</th>
                <th style={{ ...th, textAlign: "right", width: 72 }}>Learn</th>
                <th style={{ ...th, textAlign: "right", width: 72 }}>Due</th>
              </tr>
            </thead>
            <tbody>
              {store.decks.map((deck) => {
                const counts = deckCounts(store, deck, now);
                return (
                  <tr key={deck.id}>
                    <td style={td}>
                      <button
                        type="button"
                        onClick={() => onOpen(deck.id)}
                        style={{
                          padding: 0,
                          border: 0,
                          background: "none",
                          font: "inherit",
                          fontWeight: 500,
                          color: "var(--text)",
                          cursor: "pointer",
                          textAlign: "left",
                        }}
                      >
                        {deck.name}
                      </button>
                    </td>
                    <td style={{ ...td, textAlign: "right" }}>
                      <Count value={counts.new} color="var(--k-new)" />
                    </td>
                    <td style={{ ...td, textAlign: "right" }}>
                      <Count value={counts.learn} color="var(--k-learn)" />
                    </td>
                    <td style={{ ...td, textAlign: "right" }}>
                      <Count value={counts.due} color="var(--k-due)" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {studied > 0 && (
        <p style={{ margin: 0, textAlign: "center", color: "var(--text-muted)" }}>
          Studied {studied} {studied === 1 ? "card" : "cards"} today
        </p>
      )}

      <div style={{ display: "flex", justifyContent: "center", gap: 8, fontSize: 13 }}>
        <Button
          variant="ghost"
          onClick={() => downloadText(`kotoba-backup-${studyDay(Date.now())}.json`, exportStore(store))}
        >
          Back up progress
        </Button>
        <Button variant="ghost" onClick={() => restoreRef.current?.click()}>
          Restore from backup
        </Button>
      </div>
    </div>
  );
}
