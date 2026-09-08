# SOCLaaS-Experiments

Personal projects built on [SoCLaaS](https://dochub.comp.nus.edu.sg/cf/guides/soclaas/start),
NUS SoC's free OpenAI-compatible LLM gateway, plus a web front-end for the ones
that have a UI.

## Layout

```
web/                    the website — shell, sidebar, routing, per-project UI
projects/               standalone tools, one folder each
  forecaster/           binary forecaster (CLI only)
SOCLAAS.md              condensed gateway API reference
.env                    credentials, shared by everything (gitignored)
```

Two levels of abstraction, deliberately: `web/` owns the shell and knows nothing
about any project beyond a manifest, and each project owns its own folder. See
`web/src/projects/registry.ts` for the contract — it is the only file that knows
every project exists.

## Setup

One `.env` at this root serves every project. Copy the template and fill in your
key from the SoCLaaS portal:

```bash
cp .env.example .env
```

```ini
SOCLAAS_API_KEY=clsk_your_key_here
SOCLAAS_BASE_URL=https://soclaas-api.comp.nus.edu.sg/v1
```

`.env` is gitignored — **this repository is public, so never commit it.**
Exported environment variables take precedence over the file, so a shell
`export` still wins. The Python loader walks up from wherever it runs, so a
project nested several folders down still finds this one file.

Confirm the key works before anything else:

```bash
cd projects/forecaster && python soclaas_forecast.py --list-models
```

## The website

```bash
npm run install:web     # first time
npm run dev             # http://localhost:3000
```

Both delegate into `web/`, so you never need to change directory. Deployed on
Vercel with the root directory set to `web/`, behind a shared password — the
gateway bills every request to your personal key, so the site must not be open
to the internet.

## Projects

| Project | Status | |
| --- | --- | --- |
| [Chat](web/src/projects/chat) | Live on the site | Streaming chat across the SoCLaaS model catalogue |
| [API Agent](web/src/projects/apiagent) | Live on the site | Research agent over 24 public data APIs, with tiered provenance |
| [Forecaster](projects/forecaster) | CLI only | Multi-model binary forecasting with a hardened JSON layer |

### Adding a project

1. Create its folder — `projects/<name>/` for a standalone tool, or
   `web/src/projects/<name>/` for something with a UI.
2. Write a manifest.
3. Add one line to `web/src/projects/registry.ts`.

Nothing else needs to change, and no project imports another.

**Keep each experiment self-contained.** Everything specific to it — adapters,
prompts, request handler, UI, storage — lives in its own folder, so exporting or
deleting it is one directory plus one registry line. `web/src/lib/` is for the
platform only: the gateway client, environment access, the auth gate. `apiagent`
is the worked example; `chat` predates the rule and still keeps two of its own
modules in `lib/`.

## Notes on the gateway

`SOCLAAS.md` is a condensed API reference — endpoints, model catalogue, rate
limits, error codes. Rename it to `AGENTS.md` or `CLAUDE.md` if you want coding
agents to pick it up automatically.

Three things worth knowing, all established by testing rather than docs:

- The gateway is reachable **off-campus without a VPN**, though DocHub itself is
  NUS-internal.
- **`--list-models` is authoritative.** The DocHub tables disagree with
  themselves, and models your key can't use simply don't appear.
- Reasoning models return their thinking in a **separate `reasoning` field**
  alongside `content`, and it is usually the bulk of the response. Read only
  `content` and you silently discard most of what you paid for.
