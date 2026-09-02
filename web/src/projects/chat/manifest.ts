import type { ProjectManifest } from "../types";

export const chatManifest: ProjectManifest = {
  slug: "chat",
  name: "Chat",
  description: "Streaming chat across the SoCLaaS model catalogue",
  status: "live",
  path: "web/src/projects/chat",
  details:
    "A general-purpose chat interface over every chat-capable model your key " +
    "can reach. Reasoning models return their thinking separately from their " +
    "answer, and it is shown in its own panel rather than discarded.\n\n" +
    "With a search key configured, a Web toggle lets the model search and read " +
    "pages. It decides for itself whether searching helps, and every page it " +
    "opened is listed so the answer can be checked against its sources.",
  load: () => import("./ChatView"),
};
