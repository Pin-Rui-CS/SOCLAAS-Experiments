import "server-only";
import {
  convertToModelMessages,
  isToolUIPart,
  stepCountIs,
  streamText,
  type UIMessage,
} from "ai";
import { soclaas, supportsTools } from "@/lib/soclaas";
import { canDriveLoop } from "../models.ts";
import { createApiTools } from "./tools.ts";
import { lastStepPrompt, systemPrompt } from "./prompts.ts";

/**
 * The API agent's turn.
 *
 * Modelled closely on `app/api/projects/chat/route.ts`, which is the tested
 * shape for this gateway. The comments there justify most of what happens
 * below; only the differences are re-argued here.
 */

/**
 * Six, where chat uses four.
 *
 * The floor for this design is find_apis -> call_api -> call_api -> answer,
 * which is already four with no room to correct a bad parameter. Six leaves
 * one recovery and one follow-up lookup.
 *
 * It is not higher because every step is another gateway request against a
 * measured limit of 30/minute (SOCLAAS.md), and because all six share the same
 * 300s wall clock as the answer itself — and one of the adapters, GDELT,
 * deliberately waits 15 seconds before it will call out at all.
 */
const MAX_STEPS = 6;

/**
 * Drop tool calls that never got a result.
 *
 * Verbatim from the chat route, and mandatory for the same reason: pressing
 * Stop can land between a tool call and its result, and the next turn's
 * `convertToModelMessages` then throws `MissingToolResultsError` — a dead
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

  /*
   * Refuse, rather than degrade.
   *
   * Chat treats web access as optional and falls back to answering without it.
   * Here the tool loop IS the product: a model that cannot call tools would
   * answer this project's questions from memory, which is the single behaviour
   * the whole design exists to prevent. Better a clear error than a fluent
   * fabrication. The client filters the picker to the same list, but the client
   * is not the authority.
   */
  if (!supportsTools(model) || !canDriveLoop(model)) {
    return Response.json(
      {
        error:
          `${model} is not verified to run this project's research loop. ` +
          `See canDriveLoop in src/projects/apiagent/models.ts for what was ` +
          `measured and why.`,
      },
      { status: 400 },
    );
  }

  const apiTools = createApiTools();

  // Resolved once per request, so a long-lived instance does not serve a
  // stale date after midnight.
  const today = new Date();

  const result = streamText({
    model: soclaas()(model),
    // `instructions`, not `system`: prepareStep overrides this field on the
    // last step, and an override only lands if it names the same field.
    instructions: systemPrompt(today),
    messages: await convertToModelMessages(dropIncompleteToolCalls(messages)),
    tools: apiTools.tools,
    stopWhen: stepCountIs(MAX_STEPS),
    /*
     * Tools are forced at the start of the turn and denied at the end of it.
     *
     * FORCED (steps 0 and 1). SOCLAAS.md's finding is that these models emit
     * reliable tool calls "only when tool_choice forces one; unforced, larger
     * models answer from memory". Measured here on 2026-09-06, `llama3.1:8b`
     * asked how many US banks failed in 2026: it called find_apis, received
     * FDIC as a Tier A match, then never called it — and answered "0 bank
     * failures" with an invented URL, an invented query date, and the sentence
     * "This answer rests on Tier A evidence". The real figure was four. A
     * fabricated citation is worse than no answer, and this is the documented
     * mitigation. Step 0 forces the lookup; step 1 forces the model to actually
     * call something with what the lookup returned, which is the step it
     * skipped. From step 2 it is free.
     *
     * DENIED (last step). Otherwise the turn can end on a tool result with no
     * answer after it — measured on `qwen3.8:27b` in the chat project. See
     * `lastStepPrompt`: saying WHY the budget is gone matters as much as the
     * denial, or the model signs off mid-thought with "let me check".
     */
    prepareStep: ({ stepNumber }) => {
      if (stepNumber === MAX_STEPS - 1) {
        return { toolChoice: "none" as const, instructions: lastStepPrompt(today) };
      }
      if (stepNumber <= 1) return { toolChoice: "required" as const };
      return {};
    },
  });

  return result.toUIMessageStreamResponse({
    // The reasoning IS the research trail here, not a curiosity.
    sendReasoning: true,
    /*
     * What the turn cost and what it rests on.
     *
     * `tiersUsed` is the one that matters: an answer built only from Tier B
     * sources is a different kind of claim from one with a Tier A source
     * behind it, and the reader should be able to see which they got without
     * taking the model's word for it.
     */
    messageMetadata: ({ part }) => {
      if (part.type !== "finish") return undefined;

      const spent = apiTools.usage();

      return {
        model,
        lookups: spent.lookups,
        calls: spent.calls,
        failures: spent.failures,
        tiersUsed: spent.tiersUsed,
        inputTokens: part.totalUsage?.inputTokens,
        outputTokens: part.totalUsage?.outputTokens,
        totalTokens: part.totalUsage?.totalTokens,
      };
    },
    // The SDK masks server errors with "An error occurred." by default, which
    // hides exactly the gateway messages worth reading (429 quota, 403 model).
    onError: (error) =>
      error instanceof Error ? error.message : "The model request failed.",
  });
}
