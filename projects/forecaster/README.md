# forecaster

A free, model-independent binary forecaster running on
[SoCLaaS](https://dochub.comp.nus.edu.sg/cf/guides/soclaas/start), NUS SoC's
OpenAI-compatible LLM gateway.

Runs a question and research brief through several open-weight models, returns a
median probability, and records every run — including the failed ones — so a
broken forecast never disappears silently.

Command-line only. It is not exposed on the website: a single run has been
measured at 360 seconds, which no serverless function limit accommodates.

## Why

Two problems this is meant to address in a multi-model forecasting pipeline:

**Ensemble homogeneity.** Three runs of two closely related frontier models is
not really three opinions. SoCLaaS serves open-weight Qwen, Gemma, and Llama
checkpoints, which are independent of both Anthropic and OpenAI pretraining, and
it's free — so an extra ensemble member costs nothing against the per-question
budget.

**Silent failure.** A stage that returns zero output and logs nothing is worse
than one that crashes. Every run here lands in the output JSON with its status,
error string, and the raw body that failed to parse.

## Install

```bash
pip install openai
```

Python 3.10+.

## Setup

Credentials live in a single `.env` at the **repository root**, shared with
every other project here. See the root README for the format. The loader walks
up from this directory to find it, so no per-project copy is needed.

Confirm the key and network are good before anything else:

```bash
python soclaas_forecast.py --list-models
```

## Usage

```bash
# minimal
python soclaas_forecast.py -q "Will X happen before 2026-09-01?"

# with a research brief, writing full output
python soclaas_forecast.py \
    -q "Will the Silver Bulletin generic ballot average reach D+7.0 before 2026-09-01?" \
    --brief briefs/q44807.md \
    -o results/q44807_soclaas.json

# pick models explicitly
python soclaas_forecast.py -q "..." --models qwen3.6:35b,gemma4:26b,llama3.1:8b
```

| Flag | Meaning |
| --- | --- |
| `-q`, `--question` | The binary question text. Required. |
| `--brief` | Path to a research brief (markdown or plain text). |
| `--models` | Comma-separated model IDs. Defaults to an auto-picked spread across families. |
| `-n`, `--runs` | Ensemble size when auto-picking. Default 3. |
| `-o`, `--out` | Write the full result JSON here. Parent directories are created. |
| `--timeout` | Per-request timeout in seconds. Default 180. |
| `--list-models` | Print the catalogue your key can reach and exit. |

Exit code is `0` if at least one run produced a usable probability, `1` if all
runs failed (abstain).

## Tests

```bash
python test_soclaas_forecast.py       # -v for per-test output
```

96 tests. Stdlib `unittest`, no pytest, no network: the gateway client is faked,
so the repair pass and the failure-recording path run offline. Covers JSON
extraction, schema validation, the retry policy, `.env` discovery, reasoning
capture, and the per-model run loop.

## Output

```json
{
  "question": "...",
  "generated_at": "2026-08-30T09:12:44+00:00",
  "gateway": "https://soclaas-api.comp.nus.edu.sg/v1/",
  "brief_chars": 38214,
  "requested_models": ["qwen3.6:35b", "gemma4:26b", "qwen3.5:9b"],
  "runs_ok": 2,
  "runs_failed": 1,
  "median": 0.41,
  "mean": 0.415,
  "spread": 0.13,
  "runs": [
    {
      "model": "qwen3.6:35b",
      "status": "ok",
      "probability": 0.35,
      "forecast": {
        "base_rate": "...",
        "key_drivers": ["..."],
        "evidence_gaps": ["..."],
        "probability": 0.35,
        "confidence": "medium",
        "rescaled_from": null
      },
      "repaired": false,
      "attempts": 1,
      "elapsed_s": 22.4,
      "usage": {"prompt_tokens": 9412, "completion_tokens": 388, "total_tokens": 9800},
      "reasoning": "We need estimate the base rate. USGS records roughly..."
    }
  ]
}
```

Fields worth knowing:

- **`spread`** — max minus min across successful runs. Above 0.25 the script
  prints a warning; treat that as a signal the brief underdetermines the answer,
  not as noise to average away.
- **`repaired`** — the model's first reply wasn't valid JSON and it was asked
  once to fix it. Not necessarily bad, but worth watching if one model does it
  every time.
- **`rescaled_from`** — non-null means the model answered on a 0–100 scale and
  the value was divided by 100. The original is preserved so the conversion is
  never invisible.
- **`reasoning`** — the model's thinking, when the gateway returns it in a
  separate field. Reasoning models (qwen3.8 among them) put the argument here
  and only the final JSON in `content`, so this is usually the bulk of what was
  generated and the only place the actual derivation is visible. `null` for
  models that don't return one. Expect it to be long: 6k–30k characters per run
  is normal, and it varies enormously between identical requests.
- **`raw`** — present on failed runs only, holding the body that wouldn't parse.

## Design notes

**JSON handling.** Open-weight models break "strict JSON only" instructions
routinely. `extract_json` strips code fences, skips leading prose and trailing
chatter, and does a string- and escape-aware brace scan so braces inside string
values don't confuse it. If that still fails, the model is shown its own bad
output and asked once to reissue. Only then is the run marked failed.

**Ambiguous probabilities are rejected, not guessed.** A model returning `73` is
rescaled to `0.73` with `rescaled_from` recorded. A model returning `1.5` is
rejected, because that could be 1.5% or a malformed 0–1 value and nothing in the
response distinguishes them. Silent unit conversion is a real way to corrupt a
forecast while leaving the audit trail looking clean. `true` is rejected for the
same reason — `bool` subclasses `int` in Python, so it would otherwise coerce to
a 1.0 certainty.

**Retries.** 429 and 5xx get exponential backoff with jitter, four attempts.
SoCLaaS defaults are 90 requests/minute and roughly $80/day of microdollar
budget, resetting at 00:00 UTC (08:00 SGT) — generous for this workload, but the
handling is there so a burst doesn't drop a run.

**Brief truncation.** Briefs over 120,000 characters are cut, with a warning and
an explicit `[BRIEF TRUNCATED]` marker in the prompt, to stay clear of the
smaller models' context windows. Check the model's `context_length` from
`/v1/models` if you're pushing long briefs.

## Model selection

Auto-selection prefers a spread across families rather than the largest models,
since the point is decorrelation. Override with `--models` when you want
something specific.

`--list-models` is authoritative. The DocHub models table and its
recommendations block disagree in two places, and models your key isn't
permitted to use don't appear in the catalogue at all. Checked against the live
catalogue: `qwen3.6:27b` and `qwen3.8:27b` both exist, but `ornith:35b` does
not — the real IDs are `ornith1.0:35b` and `ornith1.5:35b`.

## Limitations

- **Binary questions only.** Numeric questions need a distribution spec and CDF
  rendering, not a scalar.
- **No retrieval.** This forecasts from the brief you hand it. It doesn't
  search, scrape, or verify.
- **Not for production.** SoCLaaS is provisioned for teaching, learning, and
  prototyping. If you need reliability guarantees, use a commercial provider.
- **Single runs are not reproducible.** Three identical requests to
  `qwen3.8:27b` at `temperature=0.3` returned 0.70, 0.65, and 0.65, taking 92s
  to 360s and 2.7k to 12.9k tokens. Run-to-run variance on one model is roughly
  the same size as disagreement between models, so treat a lone run's precision
  as illusory.
- **The model's sense of "now" may be wrong.** In testing, `qwen3.8:27b`
  reasoned explicitly that the current date was June 2026 when it was late
  August. Resolution dates are computed against a "now" the model may not share;
  state the date in the question or brief when it matters.

## Files

| File | |
| --- | --- |
| `soclaas_forecast.py` | The script. |
| `test_soclaas_forecast.py` | Offline test suite. |

## Security

The API key is read from the environment and never written to output. Don't
commit it, and don't deploy this anywhere others can invoke it — usage is
accounted against your key's quota.
