import type { ProjectManifest } from "../types";

export const kotobaManifest: ProjectManifest = {
  slug: "kotoba",
  name: "Kotoba",
  description: "Japanese vocab quiz with a fresh sentence every review",
  status: "live",
  path: "web/src/projects/kotoba",
  details:
    "Anki-style decks of Japanese words, quizzed as fill-in-the-blank " +
    "sentences. Every time a card comes up the model writes a new sentence, " +
    "so you learn how the word is used instead of memorising one example.\n\n" +
    "Decks and progress are stored in this browser. Back them up from the " +
    "deck list.",
  load: () => import("./KotobaView"),
};
