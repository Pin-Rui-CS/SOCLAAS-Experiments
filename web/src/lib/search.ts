import "server-only";
import { env } from "./env";

/**
 * Web search, behind one interface.
 *
 * Every provider with a key set is live at once, and the reader picks between
 * them per conversation — the two differ enough in result quality that being
 * able to compare them directly is the point. Adding a provider is a new
 * adapter here and nothing else.
 *
 * A snippet is a ROUTING signal, not evidence: it tells the model which page is
 * worth opening. The reading is done by `web-fetch.ts`. That division is what
 * lets a snippet-only provider work as well as a content-returning one — the
 * richer the provider, the fewer fetches follow.
 */

export type SearchHit = {
  title: string;
  url: string;
  snippet: string;
  /** ISO date when the provider reports one. Absent from most. */
  publishedAt?: string;
};

/**
 * How much of the search allowance is gone.
 *
 * This is the quota that actually runs out. The SoCLaaS gateway hands out $50 a
 * day against fractions of a cent per turn; a free search tier is a thousand
 * calls a MONTH, and once they are gone the web toggle silently stops working.
 */
export type SearchUsage = {
  /** Matches SearchProvider.id, so the UI can line usage up with a selection. */
  providerId: string;
  provider: string;
  used: number;
  /** Null when the provider will not say. */
  limit: number | null;
  window: "month" | "day";
  /**
   * Where the number came from, because the two are not equally trustworthy:
   *  - "api"     a dedicated usage endpoint, authoritative and always current
   *  - "headers" scraped off the last search response this server instance made,
   *              so it is accurate but only exists after a search has run
   */
  source: "api" | "headers";
};

export interface SearchProvider {
  /** Stable machine name. Travels in request bodies and localStorage. */
  id: string;
  /** Shown in the picker and on the "searched with" line. */
  name: string;
  search(query: string, signal: AbortSignal): Promise<SearchHit[]>;
  /**
   * Required, not optional: this allowance is the one that actually runs out,
   * so a provider that cannot report it is a provider not worth adding. Null is
   * still a valid answer for "not known yet" — see Brave.
   */
  usage(signal: AbortSignal): Promise<SearchUsage | null>;
}

const MAX_RESULTS = 6;

/**
 * Every provider with a key configured.
 *
 * More than one can be live at a time and the reader picks between them, so
 * this returns a list rather than a winner. Order is the default preference,
 * used only when nobody has chosen.
 */
export function listSearchProviders(): SearchProvider[] {
  const providers: SearchProvider[] = [];
  if (env.tavilyApiKey) providers.push(tavily(env.tavilyApiKey));
  if (env.braveApiKey) providers.push(brave(env.braveApiKey));
  return providers;
}

/**
 * Resolve a requested provider, falling back to the default.
 *
 * `id` arrives from the browser, so it is a request and not an instruction: an
 * unknown or unconfigured name quietly yields the default rather than failing
 * the turn. Nobody should lose a message because a stale localStorage value
 * named a provider whose key has since been removed.
 */
export function getSearchProvider(id?: string): SearchProvider | null {
  const providers = listSearchProviders();
  if (id) {
    const requested = providers.find((provider) => provider.id === id);
    if (requested) return requested;
  }
  return providers[0] ?? null;
}

/** Just the identities, for the picker. Never exposes a key. */
export function listSearchProviderChoices(): Array<{ id: string; name: string }> {
  return listSearchProviders().map(({ id, name }) => ({ id, name }));
}

/**
 * Remaining allowance for every configured provider.
 *
 * One entry per provider that answered. A provider is simply absent when it
 * cannot say yet — Brave before its first search of this server instance — and
 * that is not an error. Never throws: a quota reading is decoration, and must
 * not be able to take a page down.
 */
export async function getAllSearchUsage(): Promise<SearchUsage[]> {
  const results = await Promise.all(
    listSearchProviders().map(async (provider) => {
      try {
        return await provider.usage(AbortSignal.timeout(8_000));
      } catch {
        return null;
      }
    }),
  );

  return results.filter((usage): usage is SearchUsage => usage !== null);
}

/* -------------------------------------------------------------------------- */

/**
 * Tavily returns extracted page text in `content`, not just a snippet, so the
 * model often needs no follow-up fetch at all.
 */
function tavily(apiKey: string): SearchProvider {
  return {
    id: "tavily",
    name: "Tavily",
    async search(query, signal) {
      const response = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          query,
          max_results: MAX_RESULTS,
          search_depth: "basic",
        }),
        signal,
      });

      if (!response.ok) throw new Error(`Tavily returned ${response.status}`);

      const body = (await response.json()) as {
        results?: Array<{
          title?: string;
          url?: string;
          content?: string;
          published_date?: string;
        }>;
      };

      return (body.results ?? []).flatMap((result) =>
        result.url
          ? [
              {
                title: result.title ?? result.url,
                url: result.url,
                snippet: result.content ?? "",
                publishedAt: result.published_date,
              },
            ]
          : [],
      );
    },

    /**
     * The only provider here with a real usage endpoint, so this is
     * authoritative and current whether or not a search has happened yet.
     * It costs no credits.
     *
     * Plan-level figures win over key-level: the plan is what actually runs
     * out, and a key can sit under a plan shared with other keys.
     */
    async usage(signal) {
      const response = await fetch("https://api.tavily.com/usage", {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal,
        /*
         * Cached, because this endpoint is itself rate limited and every page
         * load asks. Polling it unthrottled earns a 429 — which then reads as
         * "quota unknown" and makes the chip vanish, the exact opposite of what
         * it is for. A minute-old count is plenty for a sidebar.
         */
        next: { revalidate: 60 },
      });

      if (!response.ok) {
        throw new Error(`Tavily usage returned ${response.status}`);
      }

      const body = (await response.json()) as {
        key?: { usage?: number; limit?: number | null };
        account?: { plan_usage?: number; plan_limit?: number | null };
      };

      const used = body.account?.plan_usage ?? body.key?.usage;
      if (typeof used !== "number") return null;

      return {
        providerId: "tavily",
        provider: "Tavily",
        used,
        limit: body.account?.plan_limit ?? body.key?.limit ?? null,
        window: "month",
        source: "api",
      };
    },
  };
}

/**
 * Last quota Brave reported, remembered between requests.
 *
 * Brave has no usage endpoint. It reports quota only in the headers of an
 * actual search response, so the only way to know without spending a credit on
 * a probe is to keep what the last real search told us.
 *
 * Module state, which on a serverless platform means per-instance and gone on a
 * cold start. That is why the reading is labelled as coming from headers: it is
 * accurate when present and simply absent otherwise, and absent is honest.
 *
 * On the FREE plan it is always absent: Brave publishes only a per-second limit
 * there and reports the monthly window as zero, so there is nothing to count.
 * A paid plan populates it. Counting Brave searches ourselves would need
 * storage that outlives one instance — a job for the usage database, not for a
 * module-level variable.
 */
let braveLastKnown: { used: number; limit: number | null } | null = null;

/**
 * `X-RateLimit-Limit: 1, 15000` and `X-RateLimit-Remaining: 0, 14523`.
 *
 * Two windows in one header, per-second first and per-month second. Only the
 * monthly pair is worth showing — the per-second one is a burst limit that
 * refills before anyone could read it.
 */
function braveMonthlyPair(header: string | null): number | null {
  if (!header) return null;
  const parts = header.split(",").map((part) => Number(part.trim()));
  const monthly = parts[1];
  return Number.isFinite(monthly) ? monthly : null;
}

/** Brave is snippet-only: expect the model to follow up with web_fetch. */
function brave(apiKey: string): SearchProvider {
  return {
    id: "brave",
    name: "Brave",
    async search(query, signal) {
      const url = new URL("https://api.search.brave.com/res/v1/web/search");
      url.searchParams.set("q", query);
      url.searchParams.set("count", String(MAX_RESULTS));

      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
          "X-Subscription-Token": apiKey,
        },
        signal,
      });

      // Read the quota off every response, including failed ones — a 429 is
      // exactly when knowing the remaining count matters most.
      const monthlyLimit = braveMonthlyPair(response.headers.get("x-ratelimit-limit"));
      const monthlyLeft = braveMonthlyPair(
        response.headers.get("x-ratelimit-remaining"),
      );

      /*
       * A monthly limit of zero means "no monthly window on this plan", NOT
       * "nothing left" — searches keep succeeding alongside it. Measured on a
       * free key, 2026-09-04:
       *
       *   x-ratelimit-limit:  50, 0
       *   x-ratelimit-policy: 50;w=1, 0;w=2592000
       *
       * Taking that literally reports "0 searches left" and turns the chip red
       * on a key that is working perfectly. Only a positive limit is a limit.
       */
      if (monthlyLimit !== null && monthlyLimit > 0 && monthlyLeft !== null) {
        braveLastKnown = { used: monthlyLimit - monthlyLeft, limit: monthlyLimit };
      }

      if (!response.ok) throw new Error(`Brave returned ${response.status}`);

      const body = (await response.json()) as {
        web?: {
          results?: Array<{
            title?: string;
            url?: string;
            description?: string;
            page_age?: string;
          }>;
        };
      };

      return (body.web?.results ?? []).flatMap((result) =>
        result.url
          ? [
              {
                title: result.title ?? result.url,
                url: result.url,
                snippet: stripTags(result.description ?? ""),
                publishedAt: result.page_age,
              },
            ]
          : [],
      );
    },

    /** Whatever the last search's headers said. Null until one has run. */
    async usage() {
      if (!braveLastKnown) return null;
      return {
        providerId: "brave",
        provider: "Brave",
        used: braveLastKnown.used,
        limit: braveLastKnown.limit,
        window: "month",
        source: "headers",
      };
    },
  };
}

/*
 * Google Programmable Search is deliberately NOT supported.
 *
 * Its Custom Search JSON API is closed to new customers and shuts down on
 * 1 January 2027 (developers.google.com/custom-search/v1/overview). Nobody can
 * sign up for it now, so an adapter would be dead code with an expiry date.
 */

/** Brave marks query terms with <strong> in descriptions. */
function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, "");
}
