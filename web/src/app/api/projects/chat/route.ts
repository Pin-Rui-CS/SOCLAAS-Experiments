import { convertToModelMessages, streamText, type UIMessage } from "ai";
import { soclaas } from "@/lib/soclaas";

/**
 * Streaming chat against any SoCLaaS chat model.
 *
 * Streaming is not a nicety here. Identical requests to `qwen3.8:27b` have
 * taken between 92 and 360 seconds; without a stream the function would sit
 * silent long enough to hit the platform's duration ceiling. Reasoning tokens
 * start arriving almost immediately, so bytes keep flowing throughout.
 */
export const maxDuration = 300;

const SYSTEM_PROMPT =
  "You are a helpful assistant. Be direct and concrete. Use markdown for " +
  "structure and fenced code blocks with a language tag for code.";

export async function POST(request: Request) {
  let messages: UIMessage[];
  let model: string;

  try {
    const body = (await request.json()) as {
      messages?: UIMessage[];
      model?: unknown;
    };
    if (!Array.isArray(body.messages)) throw new Error("messages must be an array");
    if (typeof body.model !== "string" || !body.model) {
      throw new Error("model is required");
    }
    messages = body.messages;
    model = body.model;
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "malformed request" },
      { status: 400 },
    );
  }

  const result = streamText({
    model: soclaas()(model),
    system: SYSTEM_PROMPT,
    messages: await convertToModelMessages(messages),
  });

  return result.toUIMessageStreamResponse({
    // Reasoning is the entire point of showing this gateway's output honestly:
    // for reasoning models it is the bulk of what was generated, and the only
    // place the actual derivation is visible.
    sendReasoning: true,
    onError: (error) =>
      error instanceof Error ? error.message : "The model request failed.",
  });
}
