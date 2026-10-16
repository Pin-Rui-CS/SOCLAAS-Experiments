"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { generateQuestions } from "../api";
import { judge, type Verdict } from "../check";
import type { Actions } from "../KotobaView";
import { deckCounts, nextCard, nextIntervals, schedule, studyDay, studyQueue } from "../srs";
import type { Card, Deck, Grade, Question, Store } from "../types";
import { sentenceOf } from "../words";
import { Button, Count, JP_FONT } from "./ui";

/**
 * One study session.
 *
 * Sentences are generated ahead: the card on screen plus the next few in the
 * queue, in one batch, and stored on each card as `pending` so a reload does
 * not throw them away. A card's sentence is consumed when it is graded, and
 * the one shown goes into its `recent` list so the next is a different one.
 *
 * `now` is frozen between grades. The card on screen is derived from the
 * queue rather than held in state, and a moving clock would let a learning
 * card become due mid-answer and swap itself in.
 */

/** How many upcoming cards to keep a sentence ready for. */
const LOOKAHEAD = 5;
/** Sentences remembered per card and sent back to the model as "avoid". */
const RECENT_KEPT = 5;

const GRADES: Array<{ grade: Grade; label: string; key: string; color: string }> = [
  { grade: "again", label: "Again", key: "1", color: "var(--k-wrong)" },
  { grade: "hard", label: "Hard", key: "2", color: "var(--text)" },
  { grade: "good", label: "Good", key: "3", color: "var(--k-due)" },
  { grade: "easy", label: "Easy", key: "4", color: "var(--k-new)" },
];

function remember(recent: string[], question: Question | undefined): string[] {
  if (!question) return recent;
  return [sentenceOf(question), ...recent.filter((s) => s !== sentenceOf(question))].slice(0, RECENT_KEPT);
}

export function StudyView({
  store,
  deck,
  actions,
  onExit,
}: {
  store: Store;
  deck: Deck;
  actions: Actions;
  onExit: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [lastId, setLastId] = useState<string | undefined>();
  const [side, setSide] = useState<"question" | "answer">("question");
  const [typed, setTyped] = useState("");
  const [showMeaning, setShowMeaning] = useState(deck.defaultHint !== "none");
  const [showTranslation, setShowTranslation] = useState(deck.defaultHint === "translation");
  const [failed, setFailed] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(new Set<string>());
  const inputRef = useRef<HTMLInputElement>(null);

  const card = nextCard(store, deck, now, lastId);
  const question = card?.pending;
  const counts = deckCounts(store, deck, now);
  const { update } = actions;

  /* --- Keep sentences ready ------------------------------------------------ */

  useEffect(() => {
    const ahead = [card, ...studyQueue(store, deck, now)]
      .filter((c): c is Card => !!c)
      .filter((c, i, all) => all.findIndex((x) => x.id === c.id) === i)
      .slice(0, LOOKAHEAD + 1);
    const wanted = ahead.filter((c) => !c.pending && !inFlight.current.has(c.id) && !failed.has(c.id));
    if (wanted.length === 0) return;

    wanted.forEach((c) => inFlight.current.add(c.id));
    generateQuestions(
      deck.level,
      wanted.map((c) => ({
        id: c.id,
        word: c.word,
        reading: c.reading || undefined,
        meaning: c.meaning || undefined,
        avoid: c.recent,
      })),
    )
      .then((result) => {
        const byId = new Map(result.items.map((item) => [item.id, item.question]));
        update((s) => ({
          ...s,
          cards: s.cards.map((c) => (byId.has(c.id) && !c.pending ? { ...c, pending: byId.get(c.id) } : c)),
        }));
        if (result.failed.length) {
          setFailed((prev) => new Set([...prev, ...result.failed]));
          setError("The model did not write a usable sentence for some words.");
        }
      })
      .catch((err: unknown) => {
        setFailed((prev) => new Set([...prev, ...wanted.map((c) => c.id)]));
        setError(err instanceof Error ? err.message : "Could not reach the model.");
      })
      .finally(() => wanted.forEach((c) => inFlight.current.delete(c.id)));
  }, [store, deck, now, card, failed, update]);

  /* --- Answering ----------------------------------------------------------- */

  const resetSides = useCallback(() => {
    setSide("question");
    setTyped("");
    setShowMeaning(deck.defaultHint !== "none");
    setShowTranslation(deck.defaultHint === "translation");
  }, [deck.defaultHint]);

  const check = useCallback(() => {
    if (question) setSide("answer");
  }, [question]);

  const grade = useCallback(
    (g: Grade) => {
      if (!card || side !== "answer") return;
      const at = Date.now();
      const day = studyDay(at);
      update((s) => {
        const today = s.today.day === day ? s.today : { day, studied: 0, newByDeck: {} };
        return {
          ...s,
          cards: s.cards.map((c) =>
            c.id === card.id
              ? { ...schedule(c, g, at), recent: remember(c.recent, c.pending), pending: undefined }
              : c,
          ),
          today: {
            day,
            studied: today.studied + 1,
            newByDeck:
              card.state === "new"
                ? { ...today.newByDeck, [deck.id]: (today.newByDeck[deck.id] ?? 0) + 1 }
                : today.newByDeck,
          },
        };
      });
      setLastId(card.id);
      setNow(at);
      resetSides();
    },
    [card, side, deck.id, update, resetSides],
  );

  /** Throw this sentence away and answer a new one for the same word. */
  const regenerate = useCallback(() => {
    if (!card || side !== "answer") return;
    update((s) => ({
      ...s,
      cards: s.cards.map((c) =>
        c.id === card.id ? { ...c, recent: remember(c.recent, c.pending), pending: undefined } : c,
      ),
    }));
    resetSides();
  }, [card, side, update, resetSides]);

  const retry = useCallback(() => {
    setError(null);
    setFailed(new Set());
  }, []);

  // Put the cursor in the answer box whenever a new question appears.
  useEffect(() => {
    if (side === "question" && question) inputRef.current?.focus();
  }, [side, question]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;
      // Letters typed into the answer box are the answer, not shortcuts.
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT")) return;

      if (side === "answer") {
        const g = GRADES.find((x) => x.key === e.key);
        if (g) {
          e.preventDefault();
          grade(g.grade);
        } else if (e.key === "r" || e.key === "R") {
          e.preventDefault();
          regenerate();
        }
      } else if (e.key === "h" || e.key === "H") {
        setShowMeaning((v) => !v);
      } else if (e.key === "t" || e.key === "T") {
        setShowTranslation((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [side, grade, regenerate]);

  /* --- Render -------------------------------------------------------------- */

  const header = (
    <header
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        padding: "14px 24px",
        borderBottom: "1px solid var(--border)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 13 }}>
        <Button variant="ghost" onClick={onExit} style={{ height: 32, padding: "0 8px" }}>
          Back
        </Button>
        <span style={{ fontWeight: 500 }}>{deck.name}</span>
      </div>
      <div style={{ display: "flex", gap: 14, fontSize: 14 }} aria-label={`${counts.new} new, ${counts.learn} learning, ${counts.due} due`}>
        <Count value={counts.new} color="var(--k-new)" underline={card?.state === "new"} />
        <Count
          value={counts.learn}
          color="var(--k-learn)"
          underline={card?.state === "learning" || card?.state === "relearning"}
        />
        <Count value={counts.due} color="var(--k-due)" underline={card?.state === "review"} />
      </div>
    </header>
  );

  if (!card) {
    return (
      <div style={{ minHeight: "100%", display: "flex", flexDirection: "column" }}>
        {header}
        <div style={{ flex: 1, display: "grid", placeItems: "center", padding: 24, textAlign: "center" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 16, alignItems: "center" }}>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>Done for now</h1>
            <p style={{ margin: 0, color: "var(--text-muted)" }}>
              You have finished this deck for today. New cards and reviews come back tomorrow.
            </p>
            <Button variant="dark" onClick={onExit}>
              Back to deck
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const verdict = side === "answer" && question ? judge(typed, question, card) : null;
  const intervals = nextIntervals(card, now);
  const sentenceStyle = {
    margin: 0,
    fontFamily: JP_FONT,
    fontSize: 30,
    lineHeight: 1.7,
    fontWeight: 500,
    overflowWrap: "anywhere" as const,
  };

  return (
    <div style={{ minHeight: "100%", display: "flex", flexDirection: "column" }}>
      {header}

      <div style={{ flex: "1 1 auto", display: "flex", flexDirection: "column", alignItems: "center", padding: "64px 24px 32px" }}>
        <div style={{ width: "100%", maxWidth: 680, display: "flex", flexDirection: "column", alignItems: "center", gap: 28, textAlign: "center" }}>
          {!question ? (
            failed.has(card.id) ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 12, alignItems: "center" }}>
                <p role="alert" style={{ margin: 0, color: "var(--danger)" }}>{error ?? "No sentence could be written."}</p>
                <Button variant="dark" onClick={retry}>
                  Try again
                </Button>
              </div>
            ) : (
              <p style={{ margin: 0, color: "var(--text-faint)" }} aria-live="polite">
                Writing a sentence…
              </p>
            )
          ) : side === "question" ? (
            <>
              <p lang="ja" style={sentenceStyle}>
                {question.before}
                <span
                  aria-label="blank"
                  style={{ display: "inline-block", minWidth: "4.2em", borderBottom: "2px solid var(--text)", margin: "0 0.15em" }}
                >
                  &#8203;
                </span>
                {question.after}
              </p>

              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, minHeight: 64 }}>
                {showMeaning && <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 15 }}>{card.meaning || "(no meaning saved)"}</p>}
                {showTranslation && <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 15 }}>{question.translation}</p>}
                <div style={{ display: "flex", gap: 8 }}>
                  <HintToggle label="Meaning" shortcut="H" on={showMeaning} onClick={() => setShowMeaning((v) => !v)} />
                  <HintToggle label="Translation" shortcut="T" on={showTranslation} onClick={() => setShowTranslation((v) => !v)} />
                </div>
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  check();
                }}
                style={{ width: "100%", maxWidth: 360, display: "flex", flexDirection: "column", gap: 12 }}
              >
                <label htmlFor="kotoba-answer" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
                  Your answer
                </label>
                <input
                  id="kotoba-answer"
                  ref={inputRef}
                  lang="ja"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  onKeyDown={(e) => {
                    // Enter that confirms an IME conversion must not submit the answer.
                    if (e.key === "Enter" && e.nativeEvent.isComposing) e.preventDefault();
                  }}
                  placeholder="Type the missing word"
                  style={{
                    height: 48,
                    padding: "0 14px",
                    border: "1px solid var(--border-strong)",
                    borderRadius: "var(--radius)",
                    fontFamily: JP_FONT,
                    fontSize: 20,
                    textAlign: "center",
                    color: "var(--text)",
                    background: "var(--bg-raised)",
                  }}
                />
                <Button variant="dark" type="submit" style={{ height: 44 }}>
                  Check <span style={{ opacity: 0.6, fontWeight: 400 }}>Enter</span>
                </Button>
              </form>
            </>
          ) : (
            <>
              <p lang="ja" style={sentenceStyle}>
                {question.before}
                <span style={{ color: "var(--accent)", borderBottom: "2px solid var(--accent)", margin: "0 0.15em" }}>
                  {question.answer}
                </span>
                {question.after}
              </p>

              {verdict && <VerdictLine verdict={verdict} typed={typed} question={question} />}

              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  padding: "16px 20px",
                  background: "var(--bg-subtle)",
                  borderRadius: "var(--radius)",
                  width: "100%",
                  maxWidth: 520,
                  boxSizing: "border-box",
                }}
              >
                <p style={{ margin: 0, fontSize: 16 }}>
                  <span lang="ja" style={{ fontWeight: 600, fontFamily: JP_FONT }}>{card.word}</span>{" "}
                  <span lang="ja" style={{ color: "var(--text-muted)", fontFamily: JP_FONT }}>{card.reading}</span>
                  {card.meaning && <> · {card.meaning}</>}
                </p>
                {question.form && (
                  <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 13 }}>Form here: {question.form}</p>
                )}
                <p style={{ margin: 0, fontSize: 15 }}>{question.translation}</p>
              </div>
            </>
          )}
        </div>
      </div>

      {side === "answer" && question && (
        <footer
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "flex-end",
            justifyContent: "center",
            gap: 10,
            padding: "18px 24px 28px",
            borderTop: "1px solid var(--border)",
          }}
        >
          {GRADES.map((g) => (
            <div key={g.grade} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
              <span style={{ fontSize: 12, color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>
                {intervals[g.grade]}
              </span>
              <Button
                onClick={() => grade(g.grade)}
                style={{ minWidth: 76, height: 44, padding: "0 12px", color: g.color, fontWeight: 600 }}
              >
                {g.label} <span style={{ color: "var(--text-faint)", fontWeight: 400 }}>{g.key}</span>
              </Button>
            </div>
          ))}
          <div aria-hidden="true" style={{ width: 1, height: 44, background: "var(--border)", margin: "0 6px" }} />
          <Button
            variant="ghost"
            onClick={regenerate}
            style={{ height: 44, display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M13.5 8A5.5 5.5 0 1 1 11.9 4.1" />
              <path d="M13.5 2.5v3.2h-3.2" />
            </svg>
            New sentence <span style={{ color: "var(--text-faint)" }}>R</span>
          </Button>
        </footer>
      )}
    </div>
  );
}

function HintToggle({ label, shortcut, on, onClick }: { label: string; shortcut: string; on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      style={{
        height: 32,
        padding: "0 12px",
        border: "1px solid var(--border)",
        borderRadius: 999,
        background: on ? "var(--accent-subtle)" : "var(--bg-raised)",
        color: "var(--text-muted)",
        font: "inherit",
        fontSize: 13,
        cursor: "pointer",
      }}
    >
      {label} <span style={{ color: "var(--text-faint)" }}>{shortcut}</span>
    </button>
  );
}

function VerdictLine({ verdict, typed, question }: { verdict: Verdict; typed: string; question: Question }) {
  const expected = (
    <span lang="ja" style={{ color: "var(--text-muted)", fontFamily: JP_FONT }}>
      expected {question.answer}（{question.reading}）
    </span>
  );

  if (verdict === "correct") {
    return (
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", alignItems: "center", gap: 8, fontSize: 16 }}>
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="var(--k-due)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 10.5l4 4 8-9" />
        </svg>
        <span style={{ color: "var(--k-due)", fontWeight: 500 }}>Correct</span>
        <span lang="ja" style={{ color: "var(--text-muted)", fontFamily: JP_FONT }}>{typed.trim()}</span>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", alignItems: "center", gap: 8, fontSize: 16 }}>
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="var(--k-wrong)" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
        <path d="M5 5l10 10M15 5L5 15" />
      </svg>
      {verdict === "blank" ? (
        <span style={{ color: "var(--k-wrong)", fontWeight: 500 }}>No answer</span>
      ) : (
        <>
          <span style={{ color: "var(--k-wrong)", fontWeight: 500 }}>
            {verdict === "wrong-form" ? "Right word, wrong form:" : "You typed"}
          </span>
          <span lang="ja" style={{ color: "var(--k-wrong)", textDecoration: "line-through", fontFamily: JP_FONT }}>
            {typed.trim()}
          </span>
        </>
      )}
      {expected}
    </div>
  );
}
