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
    "The contract is FORECAST-LIBRARY-HANDOFF.md at the repo root, as corrected " +
    "by `npm run test:library`, which checks each of its claims against the " +
    "live database.",
  load: () => import("./LibraryView"),
};
