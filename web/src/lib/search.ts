import "server-only";
import { env } from "./env";

/**
 * Web search, behind one interface.
 *
 * The provider is chosen by whichever API key happens to be set, so switching
 * from one to another is an environment-variable change rather than a code
 * change. Nothing above this file knows which service answered.
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

export interface SearchProvider {
  /** Shown in logs and in the "searched with" line. */
  name: string;
  search(query: string, signal: AbortSignal): Promise<SearchHit[]>;
}

const MAX_RESULTS = 6;

/** Providers are tried in this order; the first configured one wins. */
export function getSearchProvider(): SearchProvider | null {
  if (env.tavilyApiKey) return tavily(env.tavilyApiKey);
  if (env.braveApiKey) return brave(env.braveApiKey);
  if (env.googleSearchApiKey && env.googleSearchCx) {
    return google(env.googleSearchApiKey, env.googleSearchCx);
  }
  return null;
}

/** A short, safe label for the UI. Never leaks which key is set beyond a name. */
export function searchProviderName(): string | null {
  return getSearchProvider()?.name ?? null;
}

/* -------------------------------------------------------------------------- */

/**
 * Tavily returns extracted page text in `content`, not just a snippet, so the
 * model often needs no follow-up fetch at all.
 */
function tavily(apiKey: string): SearchProvider {
  return {
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
  };
}

/** Brave is snippet-only: expect the model to follow up with web_fetch. */
function brave(apiKey: string): SearchProvider {
  return {
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
  };
}

/** Google Programmable Search. Snippet-only, and capped at 100 queries/day. */
function google(apiKey: string, cx: string): SearchProvider {
  return {
    name: "Google",
    async search(query, signal) {
      const url = new URL("https://www.googleapis.com/customsearch/v1");
      url.searchParams.set("key", apiKey);
      url.searchParams.set("cx", cx);
      url.searchParams.set("q", query);
      url.searchParams.set("num", String(Math.min(MAX_RESULTS, 10)));

      const response = await fetch(url, { signal });

      if (!response.ok) throw new Error(`Google returned ${response.status}`);

      const body = (await response.json()) as {
        items?: Array<{ title?: string; link?: string; snippet?: string }>;
      };

      return (body.items ?? []).flatMap((item) =>
        item.link
          ? [
              {
                title: item.title ?? item.link,
                url: item.link,
                snippet: item.snippet ?? "",
              },
            ]
          : [],
      );
    },
  };
}

/** Brave marks query terms with <strong> in descriptions. */
function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, "");
}
