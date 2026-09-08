import type { ProjectManifest } from "../types";

export const apiAgentManifest: ProjectManifest = {
  slug: "apiagent",
  name: "API Agent",
  description: "Research agent over public data APIs",
  status: "live",
  path: "web/src/projects/apiagent",
  details:
    "Ask a question with a checkable answer. The agent searches a registry of " +
    "public data APIs — official statistics, filings, recalls, weather " +
    "observations, market prints — works out which ones could answer it, calls " +
    "them, and reasons over what came back. It shows the whole trail: what it " +
    "was thinking, which APIs it chose, the exact URL it retrieved and the raw " +
    "rows it got.\n\n" +
    "Every source carries a tier. Tier A can settle a question because it is " +
    "the record itself — an FDIC failure list, a METAR observation, an SEC " +
    "filing. Tier B is evidence only: news coverage tells you an event was " +
    "reported, not that it happened. The agent is told to keep those apart, " +
    "and the turn summary says which tiers an answer actually rests on, " +
    "whether or not the model owned up to it.\n\n" +
    "Twenty-four APIs are wired up across economics, filings, regulation, " +
    "health, security, weather, geophysics, markets, prediction markets, " +
    "software and international statistics. All but one need no key. The " +
    "registry is built to take more without changing anything but itself.",
  load: () => import("./AgentView"),
};
