import { NextResponse } from "next/server";
import { fetchBudget } from "@/lib/soclaas";

/**
 * Remaining quota for the key, for the sidebar chip.
 *
 * The portal is a separate host from the gateway, so this can fail while chat
 * works perfectly well. The caller is expected to treat that as "no chip"
 * rather than an error worth showing.
 */
export async function GET() {
  try {
    return NextResponse.json(await fetchBudget());
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    return NextResponse.json(
      { error: `Could not reach the portal: ${message}` },
      { status: 502 },
    );
  }
}
