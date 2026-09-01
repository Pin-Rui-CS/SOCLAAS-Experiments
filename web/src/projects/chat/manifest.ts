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
    "answer, and it is shown in its own panel rather than discarded.",
  load: () => import("./ChatView"),
};
