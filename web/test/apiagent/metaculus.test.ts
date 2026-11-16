import { test } from "node:test";
import assert from "node:assert/strict";
import { metaculus } from "../../src/projects/apiagent/server/adapters/metaculus.ts";

test("Metaculus reuses the shared token and prefers an API Agent override", async () => {
  const shared = process.env.METACULUS_TOKEN;
  const dedicated = process.env.METACULUS_API_TOKEN;
  const originalFetch = globalThis.fetch;
  const authorizations: (string | null)[] = [];
  globalThis.fetch = (async (_url, options) => {
    authorizations.push(new Headers(options?.headers).get("Authorization"));
    return Response.json({ results: [] });
  }) as typeof fetch;
  try {
    delete process.env.METACULUS_TOKEN;
    delete process.env.METACULUS_API_TOKEN;
    assert.equal(metaculus.available?.(), false);

    process.env.METACULUS_TOKEN = " shared-test-token ";
    assert.equal(metaculus.available?.(), true);
    await metaculus.run({ search: "recession" }, new AbortController().signal);

    process.env.METACULUS_API_TOKEN = " agent-test-token ";
    await metaculus.run({ search: "recession" }, new AbortController().signal);
    assert.deepEqual(authorizations, ["Token shared-test-token", "Token agent-test-token"]);
  } finally {
    globalThis.fetch = originalFetch;
    if (shared === undefined) delete process.env.METACULUS_TOKEN;
    else process.env.METACULUS_TOKEN = shared;
    if (dedicated === undefined) delete process.env.METACULUS_API_TOKEN;
    else process.env.METACULUS_API_TOKEN = dedicated;
  }
});
