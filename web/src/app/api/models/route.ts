import { NextResponse } from "next/server";
import { listModels, pickDefaultModel } from "@/lib/soclaas";
import { listSearchProviderChoices } from "@/lib/search";

/**
 * The model picker's data source.
 *
 * `/v1/models` is authoritative — the published docs contradict themselves on
 * model IDs, and models a key isn't permitted to use simply don't appear.
 */
export async function GET() {
  try {
    const models = await listModels();
    return NextResponse.json({
      models,
      defaultModel: pickDefaultModel(models),
      // Empty when no search key is configured, so the client can hide the web
      // toggle entirely rather than offering something that cannot work. More
      // than one entry means the reader gets a picker.
      searchProviders: listSearchProviderChoices(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    return NextResponse.json(
      { error: `Could not reach the gateway: ${message}` },
      { status: 502 },
    );
  }
}
