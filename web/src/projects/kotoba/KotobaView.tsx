"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { enrichWords } from "./api";
import { DeckList } from "./components/DeckList";
import { DeckPage } from "./components/DeckPage";
import { StudyView } from "./components/StudyView";
import { KotobaStyles } from "./components/ui";
import { newCardFields } from "./srs";
import { getSaveFailed, loadStore, newId, saveStore, subscribeSaveFailed } from "./storage";
import type { Card, Deck, Store } from "./types";
import { parseWordList } from "./words";

/**
 * Kotoba: decks of Japanese words, quizzed with a newly generated sentence
 * every time a card comes up.
 *
 * This component owns the store and every change to it; the screens get the
 * current store and callbacks. Changes go through functional updates because
 * questions arrive from the model asynchronously, and a stale copy written
 * back would drop them.
 */

type Screen = { kind: "decks" } | { kind: "deck"; id: string } | { kind: "study"; id: string };

/** The route caps an enrich request at 50 words. */
const ENRICH_CHUNK = 50;

export type AddResult = { added: number; skipped: number; enrichError?: string };

export type Actions = {
  update: (fn: (store: Store) => Store) => void;
  createDeck: (name: string) => string;
  updateDeck: (id: string, patch: Partial<Deck>) => void;
  deleteDeck: (id: string) => void;
  addWords: (deckId: string, text: string) => Promise<AddResult>;
  updateCard: (id: string, patch: Partial<Card>) => void;
  deleteCard: (id: string) => void;
  restore: (store: Store) => void;
};

/** Counts on the deck screens follow the clock this often. */
const CLOCK_MS = 30_000;

const noSubscribe = () => () => {};

/**
 * localStorage does not exist during server rendering, so the real view
 * mounts only once hydrated. That lets it read the store in its initial
 * state rather than copying it in from an effect.
 */
export default function KotobaView() {
  const hydrated = useSyncExternalStore(noSubscribe, () => true, () => false);
  return hydrated ? <Kotoba /> : null;
}

function Kotoba() {
  const [store, setStore] = useState<Store>(loadStore);
  const [screen, setScreen] = useState<Screen>({ kind: "decks" });
  const [now, setNow] = useState(() => Date.now());
  const saveFailed = useSyncExternalStore(subscribeSaveFailed, getSaveFailed, () => false);

  useEffect(() => {
    saveStore(store);
  }, [store]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), CLOCK_MS);
    return () => clearInterval(timer);
  }, []);

  const go = useCallback((next: Screen) => {
    setScreen(next);
    setNow(Date.now());
  }, []);

  const update = useCallback((fn: (s: Store) => Store) => {
    setStore((prev) => fn(prev));
  }, []);

  const createDeck = useCallback(
    (name: string) => {
      const id = newId();
      const deck: Deck = {
        id,
        name: name.trim() || "Untitled deck",
        newPerDay: 20,
        defaultHint: "none",
        level: "JLPT N4",
        createdAt: Date.now(),
      };
      update((s) => ({ ...s, decks: [...s.decks, deck] }));
      return id;
    },
    [update],
  );

  const updateDeck = useCallback(
    (id: string, patch: Partial<Deck>) =>
      update((s) => ({ ...s, decks: s.decks.map((d) => (d.id === id ? { ...d, ...patch } : d)) })),
    [update],
  );

  const deleteDeck = useCallback(
    (id: string) =>
      update((s) => ({
        ...s,
        decks: s.decks.filter((d) => d.id !== id),
        cards: s.cards.filter((c) => c.deckId !== id),
      })),
    [update],
  );

  const updateCard = useCallback(
    (id: string, patch: Partial<Card>) =>
      update((s) => ({ ...s, cards: s.cards.map((c) => (c.id === id ? { ...c, ...patch } : c)) })),
    [update],
  );

  const deleteCard = useCallback(
    (id: string) => update((s) => ({ ...s, cards: s.cards.filter((c) => c.id !== id) })),
    [update],
  );

  /**
   * Add words now, then fill in missing readings and meanings in the
   * background. The cards are usable before the fill-in returns, and a
   * failed fill-in leaves them editable rather than losing them.
   */
  const addWords = useCallback(
    async (deckId: string, text: string): Promise<AddResult> => {
      const parsed = parseWordList(text);
      const existing = new Set(
        store.cards.filter((c) => c.deckId === deckId).map((c) => c.word),
      );
      const fresh = parsed.filter((w) => !existing.has(w.word));
      const now = Date.now();
      const cards: Card[] = fresh.map((w, i) => ({
        id: newId(),
        deckId,
        word: w.word,
        reading: w.reading,
        meaning: w.meaning,
        // Keeps the pasted order: new cards are introduced oldest first.
        addedAt: now + i,
        ...newCardFields(now),
      }));
      update((s) => ({ ...s, cards: [...s.cards, ...cards] }));

      const result: AddResult = { added: cards.length, skipped: parsed.length - fresh.length };
      const incomplete = cards.filter((c) => !c.reading || !c.meaning);

      for (let i = 0; i < incomplete.length; i += ENRICH_CHUNK) {
        const chunk = incomplete.slice(i, i + ENRICH_CHUNK);
        try {
          const { items } = await enrichWords(
            chunk.map((c) => ({
              id: c.id,
              word: c.word,
              reading: c.reading || undefined,
              meaning: c.meaning || undefined,
            })),
          );
          update((s) => ({
            ...s,
            cards: s.cards.map((c) => {
              const item = items.find((it) => it.id === c.id);
              // Never overwrite something edited while the request was out.
              return item
                ? { ...c, reading: c.reading || item.reading, meaning: c.meaning || item.meaning }
                : c;
            }),
          }));
        } catch (error) {
          result.enrichError = error instanceof Error ? error.message : "Could not fill in details.";
        }
      }
      return result;
    },
    [store, update],
  );

  const restore = useCallback((next: Store) => setStore(next), []);

  const actions: Actions = {
    update,
    createDeck,
    updateDeck,
    deleteDeck,
    addWords,
    updateCard,
    deleteCard,
    restore,
  };

  const deck = screen.kind !== "decks" ? store.decks.find((d) => d.id === screen.id) : undefined;

  return (
    <div className="kotoba" style={{ height: "100%", overflowY: "auto", background: "var(--bg)" }}>
      <KotobaStyles />
      {saveFailed && (
        <div
          role="alert"
          style={{
            padding: "8px 16px",
            background: "var(--warn-bg)",
            borderBottom: "1px solid var(--warn-border)",
            color: "var(--warn-text)",
            fontSize: 13,
          }}
        >
          This browser refused to save. Progress from now on may be lost when you leave. Back up from the deck
          list.
        </div>
      )}

      {screen.kind === "study" && deck ? (
        <StudyView
          store={store}
          deck={deck}
          actions={actions}
          onExit={() => go({ kind: "deck", id: deck.id })}
        />
      ) : screen.kind === "deck" && deck ? (
        <DeckPage
          store={store}
          deck={deck}
          now={now}
          actions={actions}
          onBack={() => go({ kind: "decks" })}
          onStudy={() => go({ kind: "study", id: deck.id })}
        />
      ) : (
        <DeckList
          store={store}
          now={now}
          actions={actions}
          onOpen={(id) => go({ kind: "deck", id })}
        />
      )}
    </div>
  );
}
