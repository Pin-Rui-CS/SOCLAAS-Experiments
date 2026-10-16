/**
 * Parsing pasted or imported word lists.
 *
 * One word per line, fields split by tab or comma: `word`, `word, meaning`,
 * `word, reading`, or `word, reading, meaning`. Only the first two
 * separators split, so a meaning can keep its own commas ("to walk, to
 * stroll"). A tab-separated line splits on tabs only, which is what an Anki
 * or spreadsheet export gives.
 */

export type ParsedWord = { word: string; reading: string; meaning: string };

const KANA_ONLY = /^[぀-ゟ゠-ヿー・\s]+$/u;

function splitFields(line: string): string[] {
  if (line.includes("\t")) return line.split("\t").map((f) => f.trim());
  const parts = line.split(/[,，、]/);
  if (parts.length <= 3) return parts.map((f) => f.trim());
  return [parts[0], parts[1], parts.slice(2).join(",")].map((f) => f.trim());
}

export function parseWordList(text: string): ParsedWord[] {
  const seen = new Set<string>();
  const words: ParsedWord[] = [];

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;

    const [word = "", second = "", third = ""] = splitFields(line);
    if (!word || seen.has(word)) continue;
    seen.add(word);

    // With two fields, kana in the second slot is a reading, anything else a meaning.
    const secondIsReading = second !== "" && KANA_ONLY.test(second);
    words.push({
      word,
      reading: (third || secondIsReading) ? second : "",
      meaning: third || (secondIsReading ? "" : second),
    });
  }

  return words;
}

export function sentenceOf(q: { before: string; answer: string; after: string }): string {
  return q.before + q.answer + q.after;
}
