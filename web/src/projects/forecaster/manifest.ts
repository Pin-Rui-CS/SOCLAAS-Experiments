import type { ProjectManifest } from "../types";

export const forecasterManifest: ProjectManifest = {
  slug: "forecaster",
  name: "Forecaster",
  description: "Multi-model binary forecasting with a hardened JSON layer",
  status: "cli-only",
  path: "projects/forecaster",
  details:
    "Runs a binary question and research brief through several open-weight " +
    "models and returns a median probability, recording every run — including " +
    "the failed ones — so a broken forecast never disappears silently.\n\n" +
    "This one stays on the command line. A single run has been measured at 360 " +
    "seconds, which no serverless function limit accommodates, and the output " +
    "is a file you want to keep rather than a conversation.",
  usage: [
    "cd projects/forecaster",
    "",
    "# check your key and see the live catalogue",
    "python soclaas_forecast.py --list-models",
    "",
    "# a three-model ensemble, writing full output",
    'python soclaas_forecast.py \\',
    '    -q "Will X happen before 2027-01-01?" \\',
    "    --models qwen3.8:27b,gemma4:26b,llama3.1:8b \\",
    "    -o results/x.json",
  ].join("\n"),
};
