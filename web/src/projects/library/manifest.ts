import type { ProjectManifest } from "../types";

export const libraryManifest: ProjectManifest = {
  slug: "library",
  name: "Forecast Library",
  description: "Read-only browser for the forecasting bot's published runs",
  status: "live",
  path: "web/src/projects/library",
  details:
    "Every question the Metaculus forecasting bot runs is published to a " +
    "private Supabase library: the submitted forecast, each ensemble member's " +
    "answer, the research it read, what it cost, and — once the question " +
    "resolves — its score. This reads that library. It writes nothing and " +
    "contains no forecasting code.\n\n" +
    "Discuss opens a side chat that already knows the forecast on screen — its " +
    "question, every run's answer, the evidence check and the research brief — and " +
    "can read any transcript or research file, or the web if you allow it. " +
    "Download hands out a question's files, or one self-contained brief for " +
    "another AI.\n\n" +
    "The contract is FORECAST-LIBRARY-HANDOFF.md at the repo root, as corrected " +
    "by `npm run test:library`, which checks each of its claims against the " +
    "live database.",
  load: () => import("./LibraryView"),
};
