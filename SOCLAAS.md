# SoCLaaS API Reference (condensed)

Portable reference for the NUS SoC LLM-as-a-Service gateway. Distilled from
DocHub `cf/guides/soclaas/*` (pages last modified Aug 2026). Source pages are
NUS-network-only: <https://dochub.comp.nus.edu.sg/cf/guides/soclaas/start>

Drop this file into a repo root, or rename it `AGENTS.md` / `CLAUDE.md` /
`.cursorrules` so any coding agent picks it up as context.

---

## What it is

An OpenAI-compatible LLM API gateway run by NUS School of Computing, serving
open-weight models. Free — no billing, no real money charged. Intended for
teaching, learning, experiments, and prototypes. Works with any OpenAI-compatible
client or SDK.

Also provides Whisper audio transcription.

## Setup

```bash
export SOCLAAS_API_KEY="clsk_<prefix>_<secret>"
export SOCLAAS_BASE_URL="https://soclaas-api.comp.nus.edu.sg/v1"
```

Auth header on every `/v1/*` request:

```
Authorization: Bearer <soclaas-api-key>
```

Key format is `clsk_<prefix>_<secret>`.

Python:

```python
from openai import OpenAI
import os

client = OpenAI(
    api_key=os.environ["SOCLAAS_API_KEY"],
    base_url=os.environ["SOCLAAS_BASE_URL"],
)
```

## Endpoints

Only `/v1/*` is for application users.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/v1/models` | Model catalogue visible to this key |
| POST | `/v1/chat/completions` | Primary inference endpoint |
| POST | `/v1/responses` | OpenAI Responses API shim |
| POST | `/v1/embeddings` | Vector embeddings |
| POST | `/v1/audio/transcriptions` | Whisper transcription (multipart) |

Portal API (separate host) for key/budget info:
`https://soclaas-portal.comp.nus.edu.sg/api-key/budget`

---

### GET /v1/models

```bash
curl -sS "$SOCLAAS_BASE_URL/models" \
  -H "Authorization: Bearer $SOCLAAS_API_KEY" | jq
```

Returns standard OpenAI model fields plus a `soclaas` namespace
(`display_name`, `description`, which may be blank) and context-length fields
(`context_length`, `context_window`, `max_context_tokens`, `max_model_len`).

**Always use the `id` values returned here.** Public model names are
operator-managed aliases and can change. If a key can't use a model, that model
does not appear in the list.

### POST /v1/chat/completions

The low-transformation path — best choice for plain chat clients.

```bash
curl "$SOCLAAS_BASE_URL/chat/completions" \
  -H "Authorization: Bearer $SOCLAAS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "llama3.1:8b",
    "messages": [
      {"role": "system", "content": "Be concise."},
      {"role": "user", "content": "Say hello in one sentence."}
    ],
    "reasoning_effort": "none"
  }'
```

- `model` is required; omitting it returns 400.
- Streaming via standard SSE with `"stream": true`.
- On streaming requests the gateway forces upstream
  `stream_options.include_usage=true`; on non-streaming requests it strips
  `stream_options` before proxying.
- The gateway does **not** execute tools on this path.

### POST /v1/responses

Compatibility shim: translated into chat-completions traffic internally, then
translated back into Responses-shaped JSON or SSE.

```bash
curl "$SOCLAAS_BASE_URL/responses" \
  -H "Authorization: Bearer $SOCLAAS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model": "llama3.1:8b", "input": "Summarize SoCLaaS in one sentence."}'
```

Supported fields: `model`, `input`, `instructions`, `stream`,
`max_output_tokens`, `temperature`, `top_p`, `tools`, `tool_choice`,
`parallel_tool_calls`, `previous_response_id`.

Input rules: a string `input` becomes one user message; `instructions` becomes a
system message; array `input` is supported for message-style items and tool
outputs.

**Limitations — read before building agent loops on this:**

- `background=true` → 400, not supported.
- Response state is **not durable**. `previous_response_id` lives in one gateway
  process only, in memory, with a 15-minute TTL, and does not survive restarts.
  Unknown or expired ID → 400.
- Persisted response retrieval, response cancellation, and hosted OpenAI
  built-in tools are not implemented.

**Tools.** Client-executed (returned to you, gateway does not run them): OpenAI
function tools, custom tools, `shell` / `local_shell`, `apply_patch`.
Gateway-executed web tools: `web_fetch`, `web_search`, `web_search_preview` —
these work only if enabled globally *and* allowed by your key's policy. Forcing a
disallowed one via `tool_choice` returns 403.

### POST /v1/embeddings

```bash
curl --fail-with-body -X POST "$SOCLAAS_BASE_URL/embeddings" \
  -H "Authorization: Bearer $SOCLAAS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "<embedding-model-id>",
    "input": "SoCLaaS provides controlled access to LLM backends.",
    "encoding_format": "float"
  }'
```

- `input` takes one string or an array of strings (batching). Token-ID input is
  forwarded when the backend supports it.
- Optional forwarded fields: `encoding_format`, `dimensions`, `user`.
- The model must have the embeddings capability — a chat-only model will not
  work.
- The `model` in the *response* is the upstream provider ID, not the SoCLaaS
  public ID. Don't infer access from it; use `/v1/models`.

### POST /v1/audio/transcriptions

`multipart/form-data`, not JSON.

```bash
curl --fail-with-body -X POST "$SOCLAAS_BASE_URL/audio/transcriptions" \
  -H "Authorization: Bearer $SOCLAAS_API_KEY" \
  -F "model=<whisper-model-id>" \
  -F "file=@./recording.mp3" \
  -F "language=en" \
  -F "response_format=json"
```

Required: `file` (one file), `model`. Optional forwarded: `language`, `prompt`,
`response_format` (`json`, `text`, `verbose_json`, `srt`, `vtt`), `temperature`,
`timestamp_granularities[]`, `stream`.

Streaming: add `-F "stream=true"` with `-H "Accept: text/event-stream"` and
`--no-buffer`; SSE passes through untransformed.

Upload limit 50 MiB by default → 413 if exceeded. Errors: 400 for missing model,
missing/multiple file parts, malformed multipart, or a model without the
transcription capability; 403 for a policy-denied model.

---

## Models

Costs are **microdollars per million tokens**, used only for rate control — no
real money is charged.

| Model | Context | Input | Output | Recommended for |
| --- | --- | --- | --- | --- |
| `llama3.1:8b` | 65536 | 20000 | 30000 | Capable small-model experimentation |
| `qwen3.5:9b` | 65536 | 100000 | 150000 | Higher-quality general-purpose and multimodal |
| `gemma4:26b` | 131072 | 60000 | 300000 | Higher-quality general-purpose and multimodal |
| `qwen3-coder-next` | 196608 | 110000 | 800000 | Coding agents, software-engineering workflows |
| `qwen3.6:35b` | 262144 | 140000 | 900000 | Efficient agentic workflows, advanced coding |
| `qwen3.8:27b` | 262144 | 195000 | 900000 | High-quality general reasoning and multimodal |
| `qwen3-vl:32b` | 80000 | 104000 | 416000 | Vision-capable |
| `ornith:35b` | 262144 | 260000 | 900000 | Agentic software engineering and coding |

Picking one:

- **Learning the API** → `llama3.1:8b`. Small, fast, cheap; fine for prompts,
  streaming, structured output.
- **Interactive / Open WebUI** → best all-round conversational model; or
  `gemma4:26b` to emphasise document understanding and vision.
- **Coding agent (Codex, OpenCode)** → `qwen3-coder-next`; the `ornith` 35B for
  more advanced multi-step workflows.
- **General agent (OpenClaw, Hermes)** → `qwen3.6:35b`, MoE, good
  capability/efficiency balance for planning and tool calling.

> ⚠️ The DocHub models page contradicts itself: its table lists `qwen3.8:27b` and
> `ornith:35b`, while the recommendations below it say `qwen3.6:27b` and
> `ornith1.0:35b`. Resolve against `GET /v1/models` — that's authoritative.

## Usage limits

Defaults:

- 90 requests per minute
- 80,000,000 microdollars ($80) per day
- 800,000,000 microdollars ($800) per month

Also constrained by lifetime credits and model-level access policy. Exceeding any
limit rejects the request (429).

Windows reset on **UTC** boundaries: daily at 00:00 UTC = 08:00 SGT; monthly on
the 1st at 08:00 SGT. Usage is accounted against the authenticated API key.

Check actual limits:

```bash
curl -sS "https://soclaas-portal.comp.nus.edu.sg/api-key/budget" \
  -H "Authorization: Bearer $SOCLAAS_API_KEY" \
  -H "Content-Type: application/json"
```

Limits exist for fair use, not cost recovery, and are adjusted over time.

## Errors

Shape: `{"error": "message"}`

| Status | Causes |
| --- | --- |
| 400 | Invalid JSON, missing `model`, unsupported Responses feature, expired `previous_response_id` |
| 401 | `missing bearer token`, or `invalid API key` (invalid/revoked) |
| 403 | Model not allowed, username mapping failed, forced web tool not allowed |
| 429 | Rate limit or quota exceeded |
| 503 | Auth backend unavailable, policy enforcement unavailable, web search provider not configured |
| 5xx | Transient gateway/upstream issue — retry if the request is safe to retry |

## Good practice

- Use model IDs from `GET /v1/models`, not hardcoded names from docs.
- Retry 429 and 5xx with backoff.
- Set client-side request timeouts.
- Test with small prompts before wiring into a larger workflow.
- Keep the key in an env var. Never commit it, and don't ship it in a deployed
  service others can call — usage is billed to your key's quota.

## Third-party client configs

### OpenCode

`~/.config/opencode/opencode.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "model": "soclaas/qwen3-coder-next",
  "provider": {
    "local": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "SoCLaaS",
      "options": {
        "baseURL": "https://soclaas-api.comp.nus.edu.sg/v1",
        "apiKey": "<your SoCLaaS API key>"
      },
      "models": {
        "qwen3-coder-next": {
          "name": "qwen3-coder-next",
          "limit": { "context": 262144, "output": 32768 }
        }
      }
    }
  }
}
```

If it doesn't default to SoCLaaS, run `/models` and pick from the menu.

### Hermes Agent

`~/.hermes/config.yaml`:

```yaml
model:
  default: qwen3.6:35b
  provider: custom:soclaas
custom_providers:
  - name: SoCLaaS
    base_url: https://soclaas-api.comp.nus.edu.sg/v1
    api_key: <your SoCLaaS API key>
    model: qwen3.6:35b
    api_mode: chat_completions
    models:
      - qwen3.6:35b
```

Codex and Open WebUI are documented on DocHub separately; any OpenAI-compatible
client works with the same base URL and key.

## Access notes

DocHub documentation is reachable only from inside the NUS network. Whether the
gateway itself is similarly restricted is not stated in the docs — test
`GET /v1/models` from off-campus before depending on it.
