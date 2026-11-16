/**
 * Just enough Supabase for a read-only reader: PostgREST selects, Storage
 * downloads and a password sign-in. Plain `fetch`, no `@supabase/supabase-js`.
 *
 * Why no SDK: this subtree also runs under plain Node for `verify.ts`, which is
 * why every import here carries an explicit `.ts` extension and avoids the `@/`
 * alias — the same property `apiagent/server/http.ts` keeps for its smoke test.
 * And the reader needs four endpoints, not a client library.
 *
 * Two ways in, mirroring FORECAST-LIBRARY-HANDOFF.md §1:
 *
 * - `user`: the anon key plus the owner's email and password. The session token
 *   is what row-level security actually checks; the anon key alone reads
 *   nothing. This is the path the site uses.
 * - `service`: the secret key, which bypasses row-level security. Only
 *   `verify.ts` accepts it, and only from the process environment — the handoff
 *   forbids it anywhere in this repo, and nothing here writes it down.
 */

export type Credentials =
  | { kind: "user"; url: string; anonKey: string; email: string; password: string }
  | { kind: "service"; url: string; serviceKey: string }
  | { kind: "anon"; url: string; anonKey: string };

export const BUCKET = "forecast-runs";

/** A PostgREST or Storage response that was not a 2xx. */
export class SupabaseError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(status: number, body: string, what: string) {
    super(`${what}: HTTP ${status} ${body.slice(0, 200)}`);
    this.status = status;
    this.body = body;
  }
}

/**
 * New-style keys (`sb_publishable_…`, `sb_secret_…`) are not JWTs and go on the
 * `apikey` header only. Legacy keys are JWTs and also want `Authorization`.
 * Same rule as the publisher's `eval_tools/supabase_rest.py`.
 */
function isJwt(key: string): boolean {
  return key.split(".").length === 3;
}

export class Supabase {
  readonly url: string;
  private readonly creds: Credentials;
  private token: { value: string; expiresAt: number } | null = null;

  // No parameter properties: Node's type stripping, which verify.ts runs under, rejects them.
  constructor(creds: Credentials) {
    this.creds = creds;
    this.url = creds.url.replace(/\/+$/, "");
  }

  get kind(): Credentials["kind"] {
    return this.creds.kind;
  }

  private async headers(): Promise<Record<string, string>> {
    const creds = this.creds;
    if (creds.kind === "service") {
      const headers: Record<string, string> = { apikey: creds.serviceKey };
      if (isJwt(creds.serviceKey)) headers.Authorization = `Bearer ${creds.serviceKey}`;
      return headers;
    }
    if (creds.kind === "anon") {
      const headers: Record<string, string> = { apikey: creds.anonKey };
      if (isJwt(creds.anonKey)) headers.Authorization = `Bearer ${creds.anonKey}`;
      return headers;
    }
    return { apikey: creds.anonKey, Authorization: `Bearer ${await this.accessToken()}` };
  }

  /**
   * Sign in once and reuse the session until a minute before it expires. A
   * warm serverless instance keeps it across requests; a cold one signs in again.
   */
  private async accessToken(): Promise<string> {
    if (this.creds.kind !== "user") throw new Error("not a user session");
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;

    const response = await fetch(`${this.url}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: this.creds.anonKey, "Content-Type": "application/json" },
      body: JSON.stringify({ email: this.creds.email, password: this.creds.password }),
      cache: "no-store",
    });
    const text = await response.text();
    if (!response.ok) throw new SupabaseError(response.status, text, "sign-in");

    const body = JSON.parse(text) as { access_token: string; expires_in: number };
    this.token = {
      value: body.access_token,
      expiresAt: Date.now() + body.expires_in * 1000,
    };
    return body.access_token;
  }

  /**
   * GET `/rest/v1/<relation>?<query>`. With `count`, PostgREST reports the full
   * match count in `Content-Range` even when `limit` trims the rows.
   */
  async select<T = Record<string, unknown>>(
    relation: string,
    query: Record<string, string> = {},
    { count = false }: { count?: boolean } = {},
  ): Promise<{ rows: T[]; count: number | null }> {
    const params = new URLSearchParams(query);
    const headers = await this.headers();
    if (count) headers.Prefer = "count=exact";

    const response = await fetch(`${this.url}/rest/v1/${relation}?${params}`, {
      headers,
      cache: "no-store",
    });
    const text = await response.text();
    if (!response.ok) throw new SupabaseError(response.status, text, `select ${relation}`);

    const range = response.headers.get("content-range");
    const total = range?.split("/")[1];
    return {
      rows: JSON.parse(text) as T[],
      count: total && total !== "*" ? Number(total) : null,
    };
  }

  /**
   * Raw bytes of one stored file, or `null` when it does not exist. Handoff §4:
   * any file may be absent, and a missing one means "not produced", not an error.
   */
  async download(path: string): Promise<Uint8Array | null> {
    const response = await fetch(`${this.url}/storage/v1/object/${BUCKET}/${path}`, {
      headers: await this.headers(),
      cache: "no-store",
    });
    if (response.status === 404 || response.status === 400) {
      // Storage reports a missing object as 400 {"statusCode":"404"} on some versions.
      const text = await response.text();
      if (response.status === 404 || /not.?found|"404"/i.test(text)) return null;
      throw new SupabaseError(response.status, text, `download ${path}`);
    }
    if (!response.ok) {
      throw new SupabaseError(response.status, await response.text(), `download ${path}`);
    }
    return new Uint8Array(await response.arrayBuffer());
  }

  /** Names directly under a storage prefix. */
  async list(prefix: string): Promise<{ name: string; metadata: Record<string, unknown> | null }[]> {
    const response = await fetch(`${this.url}/storage/v1/object/list/${BUCKET}`, {
      method: "POST",
      headers: { ...(await this.headers()), "Content-Type": "application/json" },
      body: JSON.stringify({ prefix, limit: 100 }),
      cache: "no-store",
    });
    const text = await response.text();
    if (!response.ok) throw new SupabaseError(response.status, text, `list ${prefix}`);
    return JSON.parse(text);
  }
}

/** gunzip in any runtime with `DecompressionStream` — Node 18+, Edge, browsers. */
export async function gunzip(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"));
  return await new Response(stream).text();
}
