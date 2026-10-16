/**
 * Kotoba's data model. Client-safe plain types: the route imports the wire
 * shapes from here too, so the two halves cannot drift apart.
 */

/** Which hint the question side opens with. Both can still be toggled. */
export type HintLevel = "none" | "meaning" | "translation";

export type Deck = {
  id: string;
  name: string;
  newPerDay: number;
  defaultHint: HintLevel;
  /** Passed to the model to keep the rest of each sentence easy, e.g. "JLPT N4". */
  level: string;
  createdAt: number;
};

/**
 * One generated fill-in-the-blank question.
 *
 * Stored as three parts rather than a sentence with a blank marker: the
 * model never has to reproduce a marker character exactly, and the answer
 * side can highlight the word without searching the sentence for it.
 */
export type Question = {
  before: string;
  /** The target word exactly as it appears in the sentence, inflected. */
  answer: string;
  after: string;
  /** `answer` in hiragana, so typing the kana is accepted for a kanji word. */
  reading: string;
  /** The grammatical form used, e.g. "て-form + しまう". */
  form: string;
  translation: string;
};

export type CardState = "new" | "learning" | "review" | "relearning";

export type Card = {
  id: string;
  deckId: string;
  word: string;
  reading: string;
  meaning: string;
  addedAt: number;

  state: CardState;
  /** Epoch ms. Learning cards are due to the minute, review cards at a day start. */
  due: number;
  /** Days. Kept through relearning so a lapse resumes from a known interval. */
  interval: number;
  ease: number;
  /** Index into the learning (or relearning) steps. */
  step: number;
  reps: number;
  lapses: number;

  /** The last few sentences shown, fed back to the model as "avoid". */
  recent: string[];
  /** A question generated ahead of time, consumed when the card is graded. */
  pending?: Question;
};

export type Store = {
  v: 1;
  decks: Deck[];
  cards: Card[];
  /** Today's tallies; reset when the study day rolls over. */
  today: {
    day: string;
    studied: number;
    newByDeck: Record<string, number>;
  };
};

export type Grade = "again" | "hard" | "good" | "easy";

/* --- Wire shapes for /api/projects/kotoba -------------------------------- */

export type GenerateWord = {
  id: string;
  word: string;
  reading?: string;
  meaning?: string;
  avoid: string[];
};

export type GenerateRequest = { action: "generate"; level: string; words: GenerateWord[] };

export type GenerateResponse = {
  items: Array<{ id: string; question: Question }>;
  /** Ids the model produced nothing usable for, even after a retry. */
  failed: string[];
};

export type EnrichWord = { id: string; word: string; reading?: string; meaning?: string };

export type EnrichRequest = { action: "enrich"; words: EnrichWord[] };

export type EnrichResponse = {
  items: Array<{ id: string; reading: string; meaning: string }>;
};
