import { NextResponse } from "next/server";
import { fetchBudget } from "@/lib/soclaas";
import { getAllSearchUsage, listSearchProviderChoices } from "@/lib/search";

/**
 * What is left of the two allowances this site spends.
 *
 * They are not equally interesting. The gateway gives $50 a day against turns
 * costing fractions of a cent, so it is effectively unlimited; a free search
 * tier is a thousand calls a MONTH and, when it runs out, the web toggle just
 * quietly stops working. Search is the number worth watching.
 *
 * Both are fetched independently and either may be null. They come from
 * different hosts — the SoCLaaS portal is NUS-network-only, so it fails from
 * plenty of places the search API works fine from — and one being unreachable
 * must not hide the other.
 */
export async function GET() {
  const [search, gateway] = await Promise.all([
    getAllSearchUsage(),
    fetchBudget().catch(() => null),
  ]);

  /*
   * `search` is an array because more than one provider can be configured and
   * the reader chooses between them.
   *
   * `providers` is sent separately and is NOT the same list: a provider that
   * reports no usage — Brave on the free plan — is configured and selectable
   * but absent from `search`. Without this the chip could not name the
   * provider someone is actually spending, and would fall back to showing a
   * different provider's balance, which is worse than showing none.
   */
  return NextResponse.json({
    search,
    providers: listSearchProviderChoices(),
    gateway,
  });
}
