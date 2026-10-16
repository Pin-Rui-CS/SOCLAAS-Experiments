import type { Card, Question } from "./types";

/**
 * Answer comparison.
 *
 * NFKC folds full- and half-width forms together (ｱ → ア, Ａ → A), katakana
 * is folded to hiragana so a word may be typed in either, and whitespace and
 * trailing punctuation are dropped because an IME happily leaves them behind.
 */
export function normalize(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[\s　]/g, "")
    .replace(/[。、．，.,!?！？]+$/u, "")
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

/**
 * `wrong-form` is the case this project exists for: you knew which word it
 * was, typed its dictionary form, and missed how the sentence needs it used.
 */
export type Verdict = "correct" | "wrong-form" | "wrong" | "blank";

export function judge(typed: string, question: Question, card: Card): Verdict {
  const answer = normalize(typed);
  if (!answer) return "blank";
  if (answer === normalize(question.answer) || answer === normalize(question.reading)) {
    return "correct";
  }
  if (answer === normalize(card.word) || (card.reading && answer === normalize(card.reading))) {
    return "wrong-form";
  }
  return "wrong";
}
