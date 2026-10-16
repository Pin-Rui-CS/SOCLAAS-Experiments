import type { EnrichWord, GenerateWord } from "../types";

/**
 * Prompts for the two jobs the model does.
 *
 * Tuned against qwen3.6:35b on 2026-10-16. Without the worked example it
 * wrote sentences like 約束を＿＿。 — grammatical, but a blank half the
 * dictionary fits, which tests nothing. Without the "answer is ONLY the
 * word" rule it folded neighbours into the answer (連れて歩いた,
 * 経験になりました), which no learner would type.
 */
export const GENERATE_SYSTEM = `You write Japanese example sentences for a vocabulary quiz. For each target word, write ONE new, natural sentence that uses it, then split the sentence into three parts: the text before the word, the word exactly as it appears in the sentence (conjugated or inflected as the grammar requires), and the text after it.

Rules:
- The sentence must show how the word is really used: typical collocations, particles and grammar.
- Keep every other word in the sentence at or below the learner's level, so only the target word is being tested.
- Write a full sentence of about 20–40 characters with enough context (a reason, a situation, a contrast, a time) that a learner who knows the word can tell it is the ONE word that fits. A short sentence where many words would fit (約束を＿＿。) is a failure.
- Use everyday situations a learner would meet, and vary them.
- "answer" is ONLY the target word itself in its inflected form: it must start with the target word (or its stem), and contain nothing else. For a verb or adjective include only its own conjugated ending (歩いて, 忘れました, 静かで, 高くない); a following auxiliary like しまう, いる, ください, なる belongs in "after". For a noun the answer is just the noun; particles go in "before"/"after".
- Every target word must appear: never substitute a different word.
- "reading" is the answer exactly as inflected, written entirely in hiragana (歩いて → あるいて, not the dictionary reading あるく).
- "form" names the grammatical form briefly in English, e.g. "て-form + しまう", "polite past", "dictionary form".
- "translation" is a natural English translation of the whole sentence.
- Do not repeat or closely paraphrase any sentence listed under "avoid". Vary situations and grammar.

Examples of the length and context wanted (target 忘れる): before "急いで家を出たので、机の上に財布を", answer "忘れて", after "きてしまった。" — the hurry and "left on the desk" make 忘れる the only fit. Too weak: before "約束を", answer "忘れました", after "。".

Reply with JSON only, no prose and no code fences: {"items":[{"id":"...","before":"...","answer":"...","after":"...","reading":"...","form":"...","translation":"..."}]}`;

/**
 * The learner's dictionary reading goes in under a name that cannot be
 * mistaken for the output's `reading`: sent as `reading`, the model echoed
 * あるく back as the reading of 歩いて.
 */
export function generateUser(level: string, words: GenerateWord[]): string {
  return JSON.stringify({
    level,
    words: words.map((w) => ({
      id: w.id,
      word: w.word,
      dictionary_reading: w.reading,
      meaning: w.meaning,
      avoid: w.avoid,
    })),
  });
}

export const ENRICH_SYSTEM = `You fill in dictionary details for Japanese vocabulary a learner is adding to flashcards. For each word give:
- "reading": its reading in hiragana (the dictionary form's reading).
- "meaning": a short English gloss, at most about six words, the most common sense first; separate senses with "; ". For a verb start with "to".
If the learner already supplied a reading or meaning, return theirs unchanged.

Reply with JSON only, no prose and no code fences: {"items":[{"id":"...","reading":"...","meaning":"..."}]}`;

export function enrichUser(words: EnrichWord[]): string {
  return JSON.stringify({ words });
}
