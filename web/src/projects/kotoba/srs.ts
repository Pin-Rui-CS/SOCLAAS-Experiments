import type { Card, Deck, Grade, Store } from "./types";

/**
 * A simplified Anki (SM-2) scheduler.
 *
 * The same shape Anki's defaults give: new cards walk through short learning
 * steps measured in minutes, then graduate to review intervals measured in
 * days that grow by the card's ease. A lapse drops the card into a single
 * relearning step and halves nothing — Anki's default new interval after a
 * lapse is the minimum, one day.
 */

const MINUTE = 60_000;
const DAY = 86_400_000;

const LEARN_STEPS = [1, 10]; // minutes
const RELEARN_STEPS = [10]; // minutes
const GRADUATING_INTERVAL = 1; // days
const EASY_INTERVAL = 4; // days
const START_EASE = 2.5;
const MIN_EASE = 1.3;

/** The study day rolls over at 4am local time, as Anki's does. */
const DAY_ROLLOVER_HOURS = 4;

/** Local time at which the current study day began. */
export function dayStart(now: number): number {
  const d = new Date(now - DAY_ROLLOVER_HOURS * 3_600_000);
  d.setHours(DAY_ROLLOVER_HOURS, 0, 0, 0);
  return d.getTime();
}

/** The current study day as `YYYY-MM-DD`, for keying daily tallies. */
export function studyDay(now: number): string {
  const d = new Date(dayStart(now));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function newCardFields(now: number) {
  return {
    state: "new" as const,
    due: now,
    interval: 0,
    ease: START_EASE,
    step: 0,
    reps: 0,
    lapses: 0,
    recent: [],
  };
}

/** Delay for a learning step, Anki's way: Hard on the first step is halfway to the next. */
function stepDelay(steps: number[], step: number, grade: "again" | "hard" | "good"): number {
  if (grade === "again") return steps[0] * MINUTE;
  if (grade === "hard") {
    if (step === 0 && steps.length > 1) return ((steps[0] + steps[1]) / 2) * MINUTE;
    return steps[Math.min(step, steps.length - 1)] * MINUTE;
  }
  return steps[step] * MINUTE;
}

function toReview(card: Card, interval: number, now: number): Card {
  return {
    ...card,
    state: "review",
    step: 0,
    interval,
    due: dayStart(now) + interval * DAY,
  };
}

/** The card after answering it with `grade`. Leaves questions and history alone. */
export function schedule(card: Card, grade: Grade, now: number): Card {
  const reviewed = { ...card, reps: card.reps + 1 };

  if (card.state === "review") {
    const ivl = Math.max(1, card.interval);
    if (grade === "again") {
      return {
        ...reviewed,
        state: "relearning",
        step: 0,
        lapses: card.lapses + 1,
        ease: Math.max(MIN_EASE, card.ease - 0.2),
        interval: 1,
        due: now + RELEARN_STEPS[0] * MINUTE,
      };
    }
    // Each grade strictly longer than the one before, as Anki guarantees:
    // at short intervals the multipliers alone round Good and Easy together.
    const hardIvl = Math.max(ivl + 1, Math.round(ivl * 1.2));
    const goodIvl = Math.max(hardIvl + 1, Math.round(ivl * card.ease));
    const easyIvl = Math.max(goodIvl + 1, Math.round(ivl * card.ease * 1.3));
    if (grade === "hard") {
      return toReview({ ...reviewed, ease: Math.max(MIN_EASE, card.ease - 0.15) }, hardIvl, now);
    }
    if (grade === "good") return toReview(reviewed, goodIvl, now);
    return toReview({ ...reviewed, ease: card.ease + 0.15 }, easyIvl, now);
  }

  // new, learning, relearning: minute steps
  const relearning = card.state === "relearning";
  const steps = relearning ? RELEARN_STEPS : LEARN_STEPS;
  const state = relearning ? "relearning" : "learning";

  if (grade === "easy") {
    return toReview(reviewed, relearning ? card.interval + 1 : EASY_INTERVAL, now);
  }
  if (grade === "good" && card.step + 1 >= steps.length) {
    return toReview(reviewed, relearning ? card.interval : GRADUATING_INTERVAL, now);
  }

  const step = grade === "again" ? 0 : grade === "good" ? card.step + 1 : card.step;
  return { ...reviewed, state, step, due: now + stepDelay(steps, step, grade) };
}

function formatDelay(card: Card, next: Card, now: number): string {
  if (next.state === "review") {
    const days = next.interval;
    if (days < 30) return `${days}d`;
    if (days < 365) return `${(days / 30).toFixed(1).replace(/\.0$/, "")}mo`;
    return `${(days / 365).toFixed(1).replace(/\.0$/, "")}y`;
  }
  const minutes = Math.round((next.due - now) / MINUTE);
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${minutes}m`;
  return `${Math.round(minutes / 60)}h`;
}

/** What each grade button would schedule, for the labels above them. */
export function nextIntervals(card: Card, now: number): Record<Grade, string> {
  const label = (grade: Grade) => formatDelay(card, schedule(card, grade, now), now);
  return { again: label("again"), hard: label("hard"), good: label("good"), easy: label("easy") };
}

/* --- Queue ----------------------------------------------------------------- */

export function newSeenToday(store: Store, deckId: string, now: number): number {
  return store.today.day === studyDay(now) ? (store.today.newByDeck[deckId] ?? 0) : 0;
}

export type Counts = { new: number; learn: number; due: number };

export function deckCounts(store: Store, deck: Deck, now: number): Counts {
  const cards = store.cards.filter((c) => c.deckId === deck.id);
  const end = dayStart(now) + DAY;
  const remaining = Math.max(0, deck.newPerDay - newSeenToday(store, deck.id, now));
  return {
    new: Math.min(remaining, cards.filter((c) => c.state === "new").length),
    learn: cards.filter((c) => c.state === "learning" || c.state === "relearning").length,
    due: cards.filter((c) => c.state === "review" && c.due < end).length,
  };
}

/**
 * Today's cards for a deck, in the order they will be shown.
 *
 * Learning cards already due come first (they are on a minute timer), then
 * reviews, then new cards up to the day's limit, then learning cards that are
 * not due yet — shown early rather than making you wait at an empty screen,
 * which is what Anki does once nothing else is left.
 */
export function studyQueue(store: Store, deck: Deck, now: number): Card[] {
  const cards = store.cards.filter((c) => c.deckId === deck.id);
  const end = dayStart(now) + DAY;
  const learning = (c: Card) => c.state === "learning" || c.state === "relearning";
  const byDue = (a: Card, b: Card) => a.due - b.due;

  const learnDue = cards.filter((c) => learning(c) && c.due <= now).sort(byDue);
  const reviews = cards.filter((c) => c.state === "review" && c.due < end).sort(byDue);
  const remaining = Math.max(0, deck.newPerDay - newSeenToday(store, deck.id, now));
  const fresh = cards
    .filter((c) => c.state === "new")
    .sort((a, b) => a.addedAt - b.addedAt)
    .slice(0, remaining);
  const learnAhead = cards.filter((c) => learning(c) && c.due > now).sort(byDue);

  return [...learnDue, ...reviews, ...fresh, ...learnAhead];
}

/**
 * The next card to show, avoiding the one just answered when anything else is
 * available — otherwise an "Again" on the last card would put the same word
 * straight back on screen.
 */
export function nextCard(store: Store, deck: Deck, now: number, lastId?: string): Card | undefined {
  const queue = studyQueue(store, deck, now);
  return queue.find((c) => c.id !== lastId) ?? queue[0];
}
