#!/usr/bin/env python3
"""
soclaas_forecast.py — run a binary forecast through SoCLaaS open-weight models.

Purpose: a free, model-independent ensemble member you can run alongside the
paid Anthropic/OpenAI runs, plus a hardened JSON layer so a malformed response
degrades into a logged failure rather than a silent one.

Usage:
    export SOCLAAS_API_KEY="clsk_..."
    export SOCLAAS_BASE_URL="https://soclaas-api.comp.nus.edu.sg/v1"

    # discover what your key can actually reach
    python soclaas_forecast.py --list-models

    # one question, default 3-model ensemble
    python soclaas_forecast.py \
        -q "Will the Silver Bulletin generic ballot average reach D+7.0 before 2026-09-01?" \
        --brief brief.md \
        -o q44807_soclaas.json

    # pick models explicitly
    python soclaas_forecast.py -q "..." --models qwen3.6:35b,gemma4:26b,llama3.1:8b
"""

from __future__ import annotations

import argparse
import json
import os
import random
import statistics
import sys
import time
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Any

try:
    from openai import OpenAI
except ImportError:
    sys.exit("pip install openai")


# --------------------------------------------------------------------------
# config
# --------------------------------------------------------------------------

DEFAULT_BASE_URL = "https://soclaas-api.comp.nus.edu.sg/v1"

# Preference order for auto-selection. Deliberately spans different model
# families so the runs aren't three flavours of the same pretraining.
PREFERRED = [
    "qwen3.6:35b",
    "gemma4:26b",
    "qwen3.8:27b",
    "qwen3.5:9b",
    "ornith1.5:35b",
    "llama3.1:8b",
]

MAX_BRIEF_CHARS = 120_000  # keep well clear of the smaller models' context

SYSTEM_PROMPT = """You are a careful superforecaster producing a calibrated \
probability for a binary question.

Method:
1. State the reference class and its base rate before looking at the specifics.
2. Adjust from that base rate only for evidence in the brief, and say which \
piece of evidence drove each adjustment.
3. Distinguish what the resolution source will actually show on the resolution \
date from what is merely true about the world.
4. If the brief is missing something load-bearing, say so and widen rather than \
substituting a guess for the missing quantity.

Do not anchor on any probability stated inside the brief; derive your own.

Output STRICT JSON matching this schema and nothing else. No prose before or \
after, no markdown fences:

{
  "base_rate": "<reference class and its rate, one sentence>",
  "key_drivers": ["<factor and its direction>", "..."],
  "evidence_gaps": ["<what was missing or unverifiable>", "..."],
  "probability": <float between 0.0 and 1.0>,
  "confidence": "low" | "medium" | "high"
}"""

REPAIR_PROMPT = """Your previous reply was not valid JSON for the required \
schema. The parse error was:

{error}

Here is what you returned:

{raw}

Return the same forecast as STRICT JSON only. No fences, no commentary. \
Required keys: base_rate (string), key_drivers (array of strings), \
evidence_gaps (array of strings), probability (float 0-1), confidence \
(one of "low", "medium", "high")."""


# --------------------------------------------------------------------------
# result types
# --------------------------------------------------------------------------

@dataclass
class RunResult:
    model: str
    status: str                      # "ok" | "failed"
    probability: float | None = None
    forecast: dict[str, Any] | None = None
    error: str | None = None
    repaired: bool = False
    attempts: int = 0
    elapsed_s: float = 0.0
    usage: dict[str, int] = field(default_factory=dict)
    raw: str | None = None           # kept on failure so the bad output survives


# --------------------------------------------------------------------------
# JSON handling
# --------------------------------------------------------------------------

def extract_json(text: str) -> dict[str, Any]:
    """Pull the first balanced JSON object out of a model reply.

    Handles fenced blocks, leading prose, and trailing commentary — the three
    ways an open-weight model usually breaks a 'strict JSON' instruction.
    """
    if not text or not text.strip():
        raise ValueError("empty response body")

    s = text.strip()

    # strip ``` / ```json fences
    if s.startswith("```"):
        s = s.split("\n", 1)[1] if "\n" in s else s
        if s.rstrip().endswith("```"):
            s = s.rstrip()[:-3]
        s = s.strip()

    try:
        return json.loads(s)
    except json.JSONDecodeError:
        pass

    # brace-balance scan, string- and escape-aware
    start = s.find("{")
    if start == -1:
        raise ValueError(f"no JSON object found in {len(text)}-char response")

    depth = 0
    in_str = False
    esc = False
    for i in range(start, len(s)):
        ch = s[i]
        if esc:
            esc = False
            continue
        if ch == "\\":
            esc = True
            continue
        if ch == '"':
            in_str = not in_str
            continue
        if in_str:
            continue
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return json.loads(s[start : i + 1])

    raise ValueError("unterminated JSON object")


def validate(obj: dict[str, Any]) -> dict[str, Any]:
    """Check the schema and coerce the obvious near-misses."""
    if not isinstance(obj, dict):
        raise ValueError(f"expected object, got {type(obj).__name__}")

    if "probability" not in obj:
        raise ValueError("missing key: probability")

    p = obj["probability"]
    # bool subclasses int, so True would otherwise coerce to a 1.0 certainty
    if isinstance(p, bool):
        raise ValueError(f"probability not numeric: {p!r}")
    if isinstance(p, str):
        p = p.strip().rstrip("%")
        try:
            p = float(p)
        except ValueError:
            raise ValueError(f"probability not numeric: {obj['probability']!r}")
    if not isinstance(p, (int, float)):
        raise ValueError(f"probability not numeric: {p!r}")
    p = float(p)

    # A model that answers 73 instead of 0.73 is worth rescuing, but a silent
    # unit conversion is its own failure mode: 1.5 could be "1.5%" or a broken
    # 0-1 value and there is no way to tell. Reject the ambiguous band, and
    # record the rescale when we do apply one.
    obj["rescaled_from"] = None
    if 1.0 < p <= 2.0:
        raise ValueError(
            f"ambiguous probability {p}: could be {p}% or a malformed 0-1 value"
        )
    if 2.0 < p <= 100.0:
        obj["rescaled_from"] = p
        p = p / 100.0
    if not 0.0 <= p <= 1.0:
        raise ValueError(f"probability out of range: {p}")
    obj["probability"] = p

    for key in ("key_drivers", "evidence_gaps"):
        v = obj.get(key, [])
        if isinstance(v, str):
            v = [v]
        if not isinstance(v, list):
            raise ValueError(f"{key} must be a list, got {type(v).__name__}")
        obj[key] = [str(x) for x in v]

    obj["base_rate"] = str(obj.get("base_rate", "")) or None

    conf = str(obj.get("confidence", "")).lower().strip()
    obj["confidence"] = conf if conf in ("low", "medium", "high") else None

    return obj


# --------------------------------------------------------------------------
# gateway calls
# --------------------------------------------------------------------------

def call(client: OpenAI, model: str, messages: list[dict], timeout: float) -> Any:
    """One chat completion, with backoff on 429 and 5xx."""
    delay = 2.0
    last = None
    for attempt in range(1, 5):
        try:
            return client.chat.completions.create(
                model=model,
                messages=messages,
                temperature=0.3,
                timeout=timeout,
            )
        except Exception as e:  # noqa: BLE001 — SDK exception classes vary
            last = e
            status = getattr(e, "status_code", None)
            retryable = status in (429, 500, 502, 503, 504) or status is None
            if not retryable or attempt == 4:
                raise
            sleep = delay * (2 ** (attempt - 1)) + random.uniform(0, 1)
            print(
                f"    [{model}] {status or type(e).__name__}, "
                f"retry {attempt}/3 in {sleep:.1f}s",
                file=sys.stderr,
            )
            time.sleep(sleep)
    raise last  # unreachable


def usage_of(resp: Any) -> dict[str, int]:
    u = getattr(resp, "usage", None)
    if not u:
        return {}
    return {
        "prompt_tokens": getattr(u, "prompt_tokens", 0) or 0,
        "completion_tokens": getattr(u, "completion_tokens", 0) or 0,
        "total_tokens": getattr(u, "total_tokens", 0) or 0,
    }


def run_one(
    client: OpenAI, model: str, question: str, brief: str, timeout: float
) -> RunResult:
    t0 = time.time()
    res = RunResult(model=model, status="failed")

    user = f"QUESTION\n{question}\n"
    if brief:
        user += f"\nRESEARCH BRIEF\n{brief}\n"
    user += "\nProduce the JSON forecast now."

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user},
    ]

    try:
        resp = call(client, model, messages, timeout)
        res.attempts = 1
        res.usage = usage_of(resp)
        raw = (resp.choices[0].message.content or "").strip()
        res.raw = raw

        try:
            res.forecast = validate(extract_json(raw))
        except (ValueError, json.JSONDecodeError) as e:
            # one repair pass — feed the model its own bad output
            print(f"    [{model}] bad JSON ({e}); repairing", file=sys.stderr)
            repair = messages + [
                {"role": "assistant", "content": raw},
                {
                    "role": "user",
                    "content": REPAIR_PROMPT.format(error=str(e), raw=raw[:4000]),
                },
            ]
            resp2 = call(client, model, repair, timeout)
            res.attempts = 2
            res.repaired = True
            for k, v in usage_of(resp2).items():
                res.usage[k] = res.usage.get(k, 0) + v
            raw2 = (resp2.choices[0].message.content or "").strip()
            res.raw = raw2
            res.forecast = validate(extract_json(raw2))

        res.probability = res.forecast["probability"]
        res.status = "ok"
        res.raw = None  # only kept on failure; a parsed run needs no body

    except Exception as e:  # noqa: BLE001
        res.error = f"{type(e).__name__}: {e}"

    res.elapsed_s = round(time.time() - t0, 1)
    return res


# --------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------

def load_dotenv(path: str | None = None) -> str | None:
    """Read .env into the environment. Real env vars win; nothing is overwritten.

    With no argument, looked for in the working directory first, then beside the
    script, so the tool works when invoked from another directory. Returns the
    file actually loaded, or None. Deliberately minimal: no interpolation, no
    inline-comment stripping — a '#' inside a secret is a character, not a
    comment.
    """
    if path is not None:
        candidates = [path]
    else:
        here = os.path.dirname(os.path.abspath(__file__))
        candidates = [os.path.join(os.getcwd(), ".env"), os.path.join(here, ".env")]

    for path in candidates:
        if not os.path.isfile(path):
            continue
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                if line.startswith("export "):
                    line = line[len("export "):]
                key, _, val = line.partition("=")
                key = key.strip()
                val = val.strip()
                if len(val) >= 2 and val[0] == val[-1] and val[0] in "\"'":
                    val = val[1:-1]
                os.environ.setdefault(key, val)
        return path
    return None


def get_client() -> OpenAI:
    load_dotenv()
    key = os.environ.get("SOCLAAS_API_KEY")
    if not key:
        sys.exit(
            "SOCLAAS_API_KEY is not set.\n"
            "Put it in a .env file next to this script, or export it:\n"
            '    SOCLAAS_API_KEY="clsk_..."'
        )
    base = os.environ.get("SOCLAAS_BASE_URL", DEFAULT_BASE_URL).rstrip("/")
    return OpenAI(api_key=key, base_url=base)


def list_models(client: OpenAI) -> list[str]:
    return [m.id for m in client.models.list().data]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("-q", "--question", help="the binary question text")
    ap.add_argument("--brief", help="path to a research brief (markdown/text)")
    ap.add_argument("--models", help="comma-separated model IDs")
    ap.add_argument("-n", "--runs", type=int, default=3, help="ensemble size")
    ap.add_argument("-o", "--out", help="write full JSON result here")
    ap.add_argument("--timeout", type=float, default=180.0)
    ap.add_argument("--list-models", action="store_true")
    args = ap.parse_args()

    client = get_client()

    try:
        available = list_models(client)
    except Exception as e:  # noqa: BLE001
        status = getattr(e, "status_code", None)
        if status == 401:
            hint = "The key was sent and rejected — check SOCLAAS_API_KEY in .env."
        elif status == 403:
            hint = "Key is valid but not permitted here — check your key's policy."
        else:
            hint = "If this is a connection error, check you're on the NUS network."
        sys.exit(f"could not reach {client.base_url}: {e}\n{hint}")

    if args.list_models:
        for m in available:
            print(m)
        return 0

    if not args.question:
        ap.error("-q/--question is required")

    # model selection
    if args.models:
        chosen = [m.strip() for m in args.models.split(",") if m.strip()]
        missing = [m for m in chosen if m not in available]
        if missing:
            sys.exit(
                f"not in your catalogue: {', '.join(missing)}\n"
                f"available: {', '.join(available)}"
            )
    else:
        chosen = [m for m in PREFERRED if m in available][: args.runs]
        if not chosen:
            chosen = available[: args.runs]
        if not chosen:
            sys.exit("catalogue is empty for this key")

    brief = ""
    if args.brief:
        with open(args.brief, encoding="utf-8") as f:
            brief = f.read()
        if len(brief) > MAX_BRIEF_CHARS:
            print(
                f"brief is {len(brief):,} chars, truncating to {MAX_BRIEF_CHARS:,}",
                file=sys.stderr,
            )
            brief = brief[:MAX_BRIEF_CHARS] + "\n\n[BRIEF TRUNCATED]"

    print(f"question: {args.question}")
    print(f"models:   {', '.join(chosen)}")
    print(f"brief:    {len(brief):,} chars\n")

    results = [run_one(client, m, args.question, brief, args.timeout) for m in chosen]

    for r in results:
        if r.status == "ok":
            flag = " (repaired)" if r.repaired else ""
            print(f"  {r.model:<20} {r.probability:.3f}  {r.elapsed_s}s{flag}")
        else:
            print(f"  {r.model:<20} FAILED   {r.elapsed_s}s  {r.error}")

    ok = [r for r in results if r.status == "ok"]
    probs = [r.probability for r in ok]

    out = {
        "question": args.question,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "gateway": str(client.base_url),
        "brief_chars": len(brief),
        "requested_models": chosen,
        "runs_ok": len(ok),
        "runs_failed": len(results) - len(ok),
        "median": round(statistics.median(probs), 4) if probs else None,
        "mean": round(statistics.mean(probs), 4) if probs else None,
        "spread": round(max(probs) - min(probs), 4) if len(probs) > 1 else None,
        "runs": [asdict(r) for r in results],
    }

    if probs:
        print(f"\nmedian {out['median']:.3f}  over {len(ok)}/{len(results)} runs")
        if out["spread"] is not None and out["spread"] > 0.25:
            print(f"WARNING: spread {out['spread']:.3f} — runs disagree materially")
    else:
        print("\nno usable runs — ABSTAIN")

    total_tok = sum(r.usage.get("total_tokens", 0) for r in results)
    if total_tok:
        print(f"tokens: {total_tok:,}")

    if args.out:
        # after the calls have already been spent — make the path rather than
        # losing the run to a missing directory
        parent = os.path.dirname(os.path.abspath(args.out))
        os.makedirs(parent, exist_ok=True)
        with open(args.out, "w", encoding="utf-8") as f:
            json.dump(out, f, indent=2)
        print(f"wrote {args.out}")

    return 0 if probs else 1


if __name__ == "__main__":
    sys.exit(main())
