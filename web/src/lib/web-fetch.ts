import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";

/**
 * Fetch a web page and reduce it to readable text.
 *
 * The URL here comes from a language model, which means it is effectively
 * attacker-influenced: anything in the conversation, including a search result,
 * can steer it. This process holds SOCLAAS_API_KEY and runs inside a cloud
 * network with a metadata endpoint on it, so the address is validated before a
 * request is made and again after every redirect.
 */

const TIMEOUT_MS = 10_000;
const MAX_BYTES = 2 * 1024 * 1024; // 2 MiB of HTML is already an enormous page
const MAX_REDIRECTS = 3;

/**
 * Characters of extracted text kept per page.
 *
 * llama3.1:8b has 65,536 tokens of context — roughly 260,000 characters — and
 * that has to hold the conversation, the tool schemas, and every other page
 * fetched this turn. One long article can exceed it alone.
 */
export const MAX_PAGE_CHARS = 8_000;

export type FetchedPage = {
  url: string;
  title: string;
  text: string;
  /** True when the page was longer than MAX_PAGE_CHARS and was cut. */
  truncated: boolean;
};

export class BlockedUrlError extends Error {}

/* ----------------------------------------------------------------- address */

function ipv4IsPrivate(address: string): boolean {
  const [a, b] = address.split(".").map(Number);

  return (
    a === 0 || // this network
    a === 10 || // private
    a === 127 || // loopback
    (a === 169 && b === 254) || // link-local, incl. 169.254.169.254 metadata
    (a === 172 && b >= 16 && b <= 31) || // private
    (a === 192 && b === 168) || // private
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 192 && b === 0) || // IETF protocol assignments
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    a >= 224 // multicast and reserved, through 255.255.255.255
  );
}

/**
 * Expand an IPv6 address to its eight 16-bit groups.
 *
 * Parsed properly rather than matched as a string, because the same address has
 * many spellings and `new URL()` does not preserve the one you wrote:
 * `http://[::ffff:127.0.0.1]/` comes back with a hostname of `::ffff:7f00:1`.
 * A prefix check against the dotted form misses that entirely and lets loopback
 * through.
 */
function parseIPv6(address: string): number[] | null {
  const value = address.toLowerCase().split("%")[0];
  const halves = value.split("::");
  if (halves.length > 2) return null;

  const groupsOf = (part: string): number[] | null => {
    if (!part) return [];
    const out: number[] = [];

    for (const chunk of part.split(":")) {
      // A trailing dotted-quad, as in ::ffff:127.0.0.1, is two groups.
      if (chunk.includes(".")) {
        const octets = chunk.split(".").map(Number);
        if (
          octets.length !== 4 ||
          octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)
        ) {
          return null;
        }
        out.push((octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3]);
        continue;
      }

      if (!/^[0-9a-f]{1,4}$/.test(chunk)) return null;
      out.push(parseInt(chunk, 16));
    }

    return out;
  };

  const left = groupsOf(halves[0]);
  if (!left) return null;

  if (halves.length === 1) return left.length === 8 ? left : null;

  const right = groupsOf(halves[1]);
  if (!right) return null;

  const fill = 8 - left.length - right.length;
  if (fill < 0) return null;

  return [...left, ...new Array<number>(fill).fill(0), ...right];
}

function ipv6IsPrivate(address: string): boolean {
  const groups = parseIPv6(address);
  if (!groups) return true; // unparseable: refuse rather than guess

  // ::ffff:0:0/96 (IPv4-mapped) and ::/96 (IPv4-compatible, and ::1) all reach
  // IPv4 space, so decide them with the IPv4 rules.
  if (groups.slice(0, 5).every((group) => group === 0)) {
    if (groups[5] === 0xffff || groups[5] === 0) {
      const octets = [
        groups[6] >> 8,
        groups[6] & 0xff,
        groups[7] >> 8,
        groups[7] & 0xff,
      ];
      return ipv4IsPrivate(octets.join("."));
    }
  }

  const first = groups[0];
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if (first === 0) return true; // anything else low in ::/16: be conservative

  return false;
}

function addressIsPrivate(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return ipv4IsPrivate(address);
  if (version === 6) return ipv6IsPrivate(address);
  return true; // unparseable: refuse rather than guess
}

/**
 * Reject anything that is not a public web address.
 *
 * Note the residual risk this does NOT close: between resolving a hostname here
 * and `fetch` resolving it again, a hostile DNS server can return a different
 * address (rebinding). Closing that properly means dialling the validated IP
 * directly with a Host header, which `fetch` will not do. This blocks every
 * realistic case — a model talked into reading localhost or the metadata
 * endpoint — and the remainder needs an attacker-controlled domain and timing.
 */
async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BlockedUrlError(`Not a valid URL: ${raw}`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new BlockedUrlError(
      `Refused: only http and https are allowed, not ${url.protocol}`,
    );
  }

  if (url.username || url.password) {
    throw new BlockedUrlError("Refused: URLs with embedded credentials.");
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "");

  if (/\.(local|internal|localdomain)$/i.test(hostname) || hostname === "localhost") {
    throw new BlockedUrlError(`Refused: ${hostname} is not a public host.`);
  }

  // A literal address skips DNS entirely; check it directly.
  if (isIP(hostname)) {
    if (addressIsPrivate(hostname)) {
      throw new BlockedUrlError(`Refused: ${hostname} is a private address.`);
    }
    return url;
  }

  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(hostname, { all: true });
  } catch {
    throw new BlockedUrlError(`Refused: could not resolve ${hostname}.`);
  }

  if (addresses.length === 0) {
    throw new BlockedUrlError(`Refused: ${hostname} resolves to nothing.`);
  }

  // Every address must be public — one private answer is enough to refuse.
  for (const { address } of addresses) {
    if (addressIsPrivate(address)) {
      throw new BlockedUrlError(
        `Refused: ${hostname} resolves to the private address ${address}.`,
      );
    }
  }

  return url;
}

/* ------------------------------------------------------------------- fetch */

/** Read the body with a hard ceiling, so a huge page cannot exhaust memory. */
async function readCapped(response: Response): Promise<string> {
  const body = response.body;
  if (!body) return "";

  const reader = body.getReader();
  // Streaming decode, so a chunk boundary landing mid-character does not
  // produce a replacement character, and nothing larger than the cap is ever
  // held in memory at once.
  const decoder = new TextDecoder("utf-8", { fatal: false });
  let text = "";
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      const remaining = MAX_BYTES - total;
      if (value.byteLength >= remaining) {
        text += decoder.decode(value.subarray(0, remaining));
        return text;
      }

      total += value.byteLength;
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => {});
  }

  return text + decoder.decode();
}

/**
 * Follow redirects by hand, revalidating each hop.
 *
 * `redirect: "follow"` would let a public URL bounce the request to
 * 169.254.169.254 without the guard ever seeing it.
 */
async function fetchFollowing(start: URL, signal: AbortSignal): Promise<Response> {
  let url = start;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const response = await fetch(url, {
      signal,
      redirect: "manual",
      headers: {
        // Identify honestly; some sites serve a different page to unknown agents.
        "User-Agent":
          "SoCLaaS-Experiments/1.0 (+https://soclaas-experiments.vercel.app)",
        Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1",
      },
    });

    if (response.status < 300 || response.status > 399) return response;

    const location = response.headers.get("location");
    if (!location) return response;

    await response.body?.cancel().catch(() => {});
    url = await assertPublicUrl(new URL(location, url).toString());
  }

  throw new BlockedUrlError(`Refused: more than ${MAX_REDIRECTS} redirects.`);
}

/* -------------------------------------------------------------- extraction */

/**
 * Strip a page down to its article text.
 *
 * Raw HTML is worse than useless to a small model — it burns context on markup
 * and buries the content in navigation. Readability is what a browser's reader
 * mode uses; when it fails (a page that is not an article), fall back to the
 * body's text with the obvious non-content elements removed.
 */
function extract(html: string, url: string): { title: string; text: string } {
  const { document } = parseHTML(html);

  try {
    const article = new Readability(document as unknown as Document).parse();
    if (article?.textContent && article.textContent.trim().length > 200) {
      return {
        title: article.title || url,
        text: article.textContent.trim(),
      };
    }
  } catch {
    /* not an article; fall through */
  }

  for (const selector of ["script", "style", "noscript", "nav", "header", "footer", "aside"]) {
    for (const element of document.querySelectorAll(selector)) element.remove();
  }

  return {
    title: document.querySelector("title")?.textContent?.trim() || url,
    text: (document.body?.textContent ?? "").replace(/\s+/g, " ").trim(),
  };
}

/* ------------------------------------------------------------------ public */

export async function fetchPage(rawUrl: string): Promise<FetchedPage> {
  const url = await assertPublicUrl(rawUrl);
  const signal = AbortSignal.timeout(TIMEOUT_MS);

  const response = await fetchFollowing(url, signal);

  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new Error(`${response.status} ${response.statusText} for ${url.href}`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!/text\/html|application\/xhtml|text\/plain/i.test(contentType)) {
    await response.body?.cancel().catch(() => {});
    throw new Error(
      `Not a readable page: ${url.href} is ${contentType || "of unknown type"}.`,
    );
  }

  const html = await readCapped(response);
  const { title, text } = extract(html, url.href);

  return {
    url: url.href,
    title,
    text: text.slice(0, MAX_PAGE_CHARS),
    truncated: text.length > MAX_PAGE_CHARS,
  };
}
