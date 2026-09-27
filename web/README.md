# web

The website. A shell with a left-hand project menu; each project supplies its
own UI and knows nothing about the others.

## Running it

```bash
npm run dev          # from here, or `npm run dev` at the repo root
```

Credentials come from the **repository root `.env`** — `next.config.ts` loads it
so the site and the Python tools share one file. Real environment variables
always take precedence, so nothing changes on Vercel.

Four variables are needed: `SOCLAAS_API_KEY`, `SOCLAAS_BASE_URL`,
`APP_PASSWORD`, `AUTH_SECRET`. See `.env.local.example`, which also lists the
optional ones (web search, the forecast library).

## Structure

```
src/
  app/                    routing only, kept thin
    (shell)/              pages that render inside the sidebar layout
    login/                outside the shell — no sidebar
    api/
      auth/               issues the session cookie
      models/             proxies the gateway catalogue
      projects/<slug>/    a project's own endpoints, namespaced by construction
  components/shell/       sidebar and layout — the website abstraction
  lib/                    server-only: env, auth, gateway client
  projects/
    registry.ts           the ONE file that knows every project exists
    <slug>/               a self-contained project
  proxy.ts                the password gate, runs on every request
```

## Adding a project

1. `mkdir src/projects/<slug>`
2. Write `manifest.ts` exporting a `ProjectManifest`. Include `load` if it has a
   UI; omit it for a documentation-only entry.
3. Add it to the array in `src/projects/registry.ts`.
4. If it needs server endpoints, put them under `src/app/api/projects/<slug>/`.

Nothing else changes. Projects must never import each other.

## Notes

**The password gate is not optional.** Every request spends a personal API
quota. `src/proxy.ts` fails closed if `AUTH_SECRET` is missing rather than
serving unprotected.

**The key is server-side only.** `src/lib/env.ts` imports `server-only`, so
importing it from a client component is a build error, and no variable is
prefixed `NEXT_PUBLIC_`. Verified: the key appears in neither `.next/static`
nor `.next/server` after a build.

**Reasoning is shown, not persisted.** Reasoning models return their thinking
separately from their answer, and it is usually the bulk of the response. It
streams into a collapsible panel and is deliberately excluded from
`localStorage` — a single block measured 30k characters against a ~5MB budget.

## Deploying

Vercel project with **Root Directory = `web`**. Set the four environment
variables in project settings. `vercel.json` pins the function region to
Singapore, co-located with the NUS gateway.

Worth setting an **Ignored Build Step** so Python-only pushes don't rebuild the
site:

```bash
git diff --quiet HEAD^ HEAD -- .
```
