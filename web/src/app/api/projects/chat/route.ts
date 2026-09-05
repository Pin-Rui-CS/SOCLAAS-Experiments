import {
  convertToModelMessages,
  isToolUIPart,
  stepCountIs,
  streamText,
  type UIMessage,
} from "ai";
import { soclaas, supportsTools } from "@/lib/soclaas";
import { getSearchProvider } from "@/lib/search";
import { createWebTools } from "@/lib/web-tools";

/**
 * Streaming chat against any SoCLaaS chat model, optionally with web access.
 *
 * Streaming is not a nicety here. Identical requests to `qwen3.8:27b` have
 * taken between 92 and 360 seconds, and without a stream the user watches a
 * blank screen for minutes while intermediaries are free to drop an idle
 * connection.
 *
 * It does NOT buy extra time. `maxDuration` is total wall clock — a streaming
 * request and a silent one are killed at the same second — which is why the
 * tool loop below is capped rather than left to run as long as it likes.
 */
export const maxDuration = 300;

/**
 * Enough for: search, read a page, search again with better terms, answer.
 *
 * Every step is another gateway request against a 30/minute limit, and they all
 * come out of the same 300s as the final answer. Four is the point where a
 * second attempt is possible without the budget becoming unpredictable.
 */
const MAX_STEPS = 4;

const SYSTEM_PROMPT =
  "You are a helpful assistant. Be direct and concrete. Use markdown for " +
  "structure and fenced code blocks with a language tag for code.";

/**
 * Added only when web access is actually available for this request.
 *
 * The tool descriptions carry the detailed criteria; this states the norm and,
 * importantly, asks the model to admit when it did not search. A silently
 * skipped search is the main failure mode of leaving the decision to the model,
 * and this is what makes it visible instead.
 */
const WEB_SYSTEM_PROMPT =
  "\n\nYou can search and read the web. Decide for yourself whether it helps: " +
  "search when the answer turns on current, specific, or checkable facts, and " +
  "skip it when you reliably know the answer already. Search snippets tell you " +
  "which page is worth opening — use web_fetch to read one before relying on " +
  "its details. Cite the URLs you actually used. If you answer a time-sensitive " +
  "question from memory without searching, say so plainly.";

/**
 * Drop tool calls that never got a result.
 *
 * Pressing Stop can land between a tool call and its result. That message then
 * holds a call with nothing answering it, and the next turn's
 * `convertToModelMessages` throws `MissingToolResultsError` — a dead
 * conversation from one mistimed click.
 */
function dropIncompleteToolCalls(messages: UIMessage[]): UIMessage[] {
  return messages.map((message) => {
    if (message.role !== "assistant") return message;

    const parts = message.parts.filter(
      (part) =>
        !isToolUIPart(part) ||
        part.state === "output-available" ||
        part.state === "output-error",
    );

    return parts.length === message.parts.length ? message : { ...message, parts };
  });
}

export async function POST(request: Request) {
  let messages: UIMessage[];
  let model: string;
  let web = false;
  let searchProviderId: string | undefined;

  try {
    const body = (await request.json()) as {
      messages?: UIMessage[];
      model?: unknown;
      web?: unknown;
      searchProvider?: unknown;
    };
    if (!Array.isArray(body.messages)) throw new Error("messages must be an array");
    if (typeof body.model !== "string" || !body.model) {
      throw new Error("model is required");
    }
    messages = body.messages;
    model = body.model;
    web = body.web === true;
    searchProviderId =
      typeof body.searchProvider === "string" ? body.searchProvider : undefined;
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "malformed request" },
      { status: 400 },
    );
  }

  /*
   * Three independent conditions, all required. The client hides the toggle
   * when search is unconfigured or the model is unverified, but the client is
   * not the authority on either.
   *
   * The requested provider is likewise a preference, not a command:
   * getSearchProvider falls back to the default if the name is unknown, so a
   * stale choice in someone's localStorage cannot break a turn.
   */
  const provider = web ? getSearchProvider(searchProviderId) : null;
  const webTools =
    provider && supportsTools(model) ? createWebTools(provider) : undefined;
  const tools = webTools?.tools;

  const result = streamText({
    model: soclaas()(model),
    // `instructions`, not `system`: prepareStep below overrides this field on
    // the last step, and an override only lands if it names the same field.
    instructions: tools ? SYSTEM_PROMPT + WEB_SYSTEM_PROMPT : SYSTEM_PROMPT,
    messages: await convertToModelMessages(dropIncompleteToolCalls(messages)),
    tools,
    // Without a stop condition the loop would run until the model stopped
    // calling tools, which on a small model can be a while.
    stopWhen: stepCountIs(MAX_STEPS),
    /*
     * Take the tools away on the last permitted step.
     *
     * Measured: asked a question whose searches kept failing, qwen3.8:27b spent
     * all four steps calling tools and the turn ended on a tool result with no
     * answer after it — the reader got panels, some half-narration, and nothing
     * else. Denying tools on the final step forces it to say something with
     * whatever it managed to gather, which is always better than silence.
     */
    prepareStep: tools
      ? ({ stepNumber }) =>
          stepNumber === MAX_STEPS - 1
            ? {
                toolChoice: "none" as const,
                // Denying tools is not enough on its own: the model will
                // otherwise sign off mid-thought with "let me check". Tell it
                // the budget is gone so it wraps up and names what is unverified.
                instructions:
                  SYSTEM_PROMPT +
                  WEB_SYSTEM_PROMPT +
                  " You have no tool calls left. Answer now with what you " +
                  "already gathered, and state plainly which parts you could " +
                  "not verify. Do not promise to check anything further.",
              }
            : {}
      : undefined,
  });

  return result.toUIMessageStreamResponse({
    // Reasoning is the entire point of showing this gateway's output honestly:
    // for reasoning models it is the bulk of what was generated, and the only
    // place the actual derivation is visible.
    sendReasoning: true,
    /*
     * What the turn cost, reported once at the end.
     *
     * Tokens come from the gateway, which forces `include_usage` upstream on
     * streams so they survive streaming. Search counts come from the tool
     * closure, read here because `finish` is the only point at which the loop
     * is definitely over and the tally is final.
     */
    messageMetadata: ({ part }) => {
      if (part.type !== "finish") return undefined;

      const spent = webTools?.usage();

      return {
        model,
        web: Boolean(webTools),
        searchProvider: provider?.name,
        searchProviderId: provider?.id,
        attempted: spent?.attempted ?? 0,
        searches: spent?.searches ?? 0,
        pagesRead: spent?.pagesRead ?? 0,
        credits: spent?.credits ?? 0,
        inputTokens: part.totalUsage?.inputTokens,
        outputTokens: part.totalUsage?.outputTokens,
        totalTokens: part.totalUsage?.totalTokens,
      };
    },
    onError: (error) =>
      error instanceof Error ? error.message : "The model request failed.",
  });
}
