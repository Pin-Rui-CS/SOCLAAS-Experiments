#!/usr/bin/env python3
"""
Tests for soclaas_forecast.py — parsing, validation, and the run loop.

Stdlib unittest, no pytest: the project's only dependency is `openai`, and the
gateway is never touched. The model client is faked so the repair pass and the
failure-recording path are exercised offline.

    python test_soclaas_forecast.py
    python test_soclaas_forecast.py -v
"""

from __future__ import annotations

import json
import os
import shutil
import tempfile
import unittest
from dataclasses import asdict
from typing import Any

import soclaas_forecast as sf


# --------------------------------------------------------------------------
# fakes
# --------------------------------------------------------------------------

class FakeUsage:
    def __init__(self, prompt: int = 100, completion: int = 20) -> None:
        self.prompt_tokens = prompt
        self.completion_tokens = completion
        self.total_tokens = prompt + completion


class FakeResponse:
    """Mimics the shape run_one reads: .choices[0].message.content and .usage."""

    def __init__(self, content: str | None, usage: FakeUsage | None = None) -> None:
        message = type("Msg", (), {"content": content})()
        choice = type("Choice", (), {"message": message})()
        self.choices = [choice]
        self.usage = usage if usage is not None else FakeUsage()


class FakeError(Exception):
    """Stands in for an SDK error; `call` reads .status_code off it."""

    def __init__(self, status_code: int | None, msg: str = "boom") -> None:
        super().__init__(msg)
        self.status_code = status_code


class FakeClient:
    """Replays a scripted list of responses/exceptions, one per create() call."""

    def __init__(self, script: list[Any]) -> None:
        self.script = list(script)
        self.calls: list[dict[str, Any]] = []
        outer = self

        class Completions:
            def create(self, **kwargs: Any) -> Any:
                outer.calls.append(kwargs)
                if not outer.script:
                    raise AssertionError("FakeClient script exhausted")
                item = outer.script.pop(0)
                if isinstance(item, Exception):
                    raise item
                return item

        self.chat = type("Chat", (), {"completions": Completions()})()


GOOD = json.dumps(
    {
        "base_rate": "Leads of this size persist in about 40% of cycles.",
        "key_drivers": ["incumbent approval trending down"],
        "evidence_gaps": ["no post-August polling in the brief"],
        "probability": 0.35,
        "confidence": "medium",
    }
)


# --------------------------------------------------------------------------
# extract_json
# --------------------------------------------------------------------------

class TestExtractJson(unittest.TestCase):
    def test_plain_object(self):
        self.assertEqual(sf.extract_json('{"probability": 0.4}'), {"probability": 0.4})

    def test_surrounding_whitespace(self):
        self.assertEqual(sf.extract_json('\n\n  {"a": 1}  \n'), {"a": 1})

    def test_json_fence(self):
        self.assertEqual(sf.extract_json('```json\n{"a": 1}\n```'), {"a": 1})

    def test_bare_fence(self):
        self.assertEqual(sf.extract_json('```\n{"a": 1}\n```'), {"a": 1})

    def test_leading_prose(self):
        text = 'Sure! Here is my forecast:\n\n{"probability": 0.6}'
        self.assertEqual(sf.extract_json(text), {"probability": 0.6})

    def test_trailing_commentary(self):
        text = '{"probability": 0.6}\n\nLet me know if you want me to revise this.'
        self.assertEqual(sf.extract_json(text), {"probability": 0.6})

    def test_prose_both_sides(self):
        text = 'Here you go:\n```json\n{"probability": 0.2}\n```\nHope that helps!'
        self.assertEqual(sf.extract_json(text), {"probability": 0.2})

    def test_nested_object(self):
        text = 'noise {"a": {"b": {"c": 1}}, "d": 2} noise'
        self.assertEqual(sf.extract_json(text), {"a": {"b": {"c": 1}}, "d": 2})

    def test_brace_inside_string_value(self):
        """The scan is string-aware: a '}' in a value must not end the object."""
        text = 'x {"note": "use {curly} braces", "probability": 0.5} y'
        got = sf.extract_json(text)
        self.assertEqual(got["note"], "use {curly} braces")
        self.assertEqual(got["probability"], 0.5)

    def test_unbalanced_brace_inside_string(self):
        text = '{"note": "an unclosed { brace", "probability": 0.5} trailing'
        got = sf.extract_json(text)
        self.assertEqual(got["note"], "an unclosed { brace")

    def test_escaped_quote_inside_string(self):
        text = 'lead {"note": "he said \\"maybe\\" }", "probability": 0.5} tail'
        got = sf.extract_json(text)
        self.assertEqual(got["note"], 'he said "maybe" }')
        self.assertEqual(got["probability"], 0.5)

    def test_escaped_backslash_before_quote(self):
        text = r'{"note": "ends with backslash \\", "probability": 0.5}'
        got = sf.extract_json(text)
        self.assertEqual(got["note"], "ends with backslash \\")

    def test_first_of_two_objects(self):
        text = '{"probability": 0.1} and also {"probability": 0.9}'
        self.assertEqual(sf.extract_json(text), {"probability": 0.1})

    def test_empty_string(self):
        with self.assertRaises(ValueError):
            sf.extract_json("")

    def test_whitespace_only(self):
        with self.assertRaises(ValueError):
            sf.extract_json("   \n\t ")

    def test_no_object_at_all(self):
        with self.assertRaisesRegex(ValueError, "no JSON object found"):
            sf.extract_json("I cannot provide a probability for this question.")

    def test_unterminated_object(self):
        with self.assertRaisesRegex(ValueError, "unterminated"):
            sf.extract_json('{"probability": 0.5, "base_rate": "cut off mid-')

    def test_malformed_body_raises(self):
        """Balanced braces but invalid JSON inside still fails loudly."""
        with self.assertRaises((ValueError, json.JSONDecodeError)):
            sf.extract_json("{probability: 0.5,}")


# --------------------------------------------------------------------------
# validate
# --------------------------------------------------------------------------

class TestValidateProbability(unittest.TestCase):
    def test_unit_interval_passthrough(self):
        got = sf.validate({"probability": 0.35})
        self.assertEqual(got["probability"], 0.35)
        self.assertIsNone(got["rescaled_from"])

    def test_int_zero_and_one(self):
        self.assertEqual(sf.validate({"probability": 0})["probability"], 0.0)
        self.assertEqual(sf.validate({"probability": 1})["probability"], 1.0)

    def test_percent_rescaled_and_recorded(self):
        got = sf.validate({"probability": 73})
        self.assertAlmostEqual(got["probability"], 0.73)
        self.assertEqual(got["rescaled_from"], 73.0)

    def test_percent_upper_bound(self):
        got = sf.validate({"probability": 100})
        self.assertEqual(got["probability"], 1.0)
        self.assertEqual(got["rescaled_from"], 100.0)

    def test_just_above_ambiguous_band_rescales(self):
        got = sf.validate({"probability": 2.5})
        self.assertAlmostEqual(got["probability"], 0.025)
        self.assertEqual(got["rescaled_from"], 2.5)

    def test_ambiguous_band_rejected(self):
        for p in (1.01, 1.5, 2.0):
            with self.subTest(p=p):
                with self.assertRaisesRegex(ValueError, "ambiguous"):
                    sf.validate({"probability": p})

    def test_out_of_range_high(self):
        with self.assertRaisesRegex(ValueError, "out of range"):
            sf.validate({"probability": 101})

    def test_out_of_range_negative(self):
        with self.assertRaisesRegex(ValueError, "out of range"):
            sf.validate({"probability": -0.2})

    def test_numeric_string(self):
        self.assertAlmostEqual(sf.validate({"probability": "0.42"})["probability"], 0.42)

    def test_percent_string(self):
        got = sf.validate({"probability": "73%"})
        self.assertAlmostEqual(got["probability"], 0.73)
        self.assertEqual(got["rescaled_from"], 73.0)

    def test_padded_string(self):
        got = sf.validate({"probability": "  0.6 "})
        self.assertAlmostEqual(got["probability"], 0.6)

    def test_non_numeric_string(self):
        with self.assertRaisesRegex(ValueError, "not numeric"):
            sf.validate({"probability": "high"})

    def test_none_probability(self):
        with self.assertRaisesRegex(ValueError, "not numeric"):
            sf.validate({"probability": None})

    def test_list_probability(self):
        with self.assertRaisesRegex(ValueError, "not numeric"):
            sf.validate({"probability": [0.5]})

    def test_missing_probability(self):
        with self.assertRaisesRegex(ValueError, "missing key"):
            sf.validate({"base_rate": "something"})

    def test_non_dict_input(self):
        with self.assertRaisesRegex(ValueError, "expected object"):
            sf.validate(["not", "a", "dict"])

    def test_bool_is_not_a_probability(self):
        """bool subclasses int; True must not coerce to a 1.0 certainty."""
        for p in (True, False):
            with self.subTest(p=p):
                with self.assertRaisesRegex(ValueError, "not numeric"):
                    sf.validate({"probability": p})


class TestValidateFields(unittest.TestCase):
    def test_lists_preserved(self):
        got = sf.validate(
            {"probability": 0.5, "key_drivers": ["a", "b"], "evidence_gaps": ["c"]}
        )
        self.assertEqual(got["key_drivers"], ["a", "b"])
        self.assertEqual(got["evidence_gaps"], ["c"])

    def test_bare_string_wrapped_in_list(self):
        got = sf.validate({"probability": 0.5, "key_drivers": "only one driver"})
        self.assertEqual(got["key_drivers"], ["only one driver"])

    def test_missing_lists_default_empty(self):
        got = sf.validate({"probability": 0.5})
        self.assertEqual(got["key_drivers"], [])
        self.assertEqual(got["evidence_gaps"], [])

    def test_list_items_stringified(self):
        got = sf.validate({"probability": 0.5, "key_drivers": [1, 2.5]})
        self.assertEqual(got["key_drivers"], ["1", "2.5"])

    def test_dict_for_list_field_rejected(self):
        with self.assertRaisesRegex(ValueError, "key_drivers must be a list"):
            sf.validate({"probability": 0.5, "key_drivers": {"a": "b"}})

    def test_confidence_normalised(self):
        for raw, want in (("HIGH", "high"), (" Medium ", "medium"), ("low", "low")):
            with self.subTest(raw=raw):
                got = sf.validate({"probability": 0.5, "confidence": raw})
                self.assertEqual(got["confidence"], want)

    def test_unknown_confidence_becomes_none(self):
        got = sf.validate({"probability": 0.5, "confidence": "very high indeed"})
        self.assertIsNone(got["confidence"])

    def test_missing_confidence_becomes_none(self):
        self.assertIsNone(sf.validate({"probability": 0.5})["confidence"])

    def test_base_rate_kept(self):
        got = sf.validate({"probability": 0.5, "base_rate": "40% of cycles"})
        self.assertEqual(got["base_rate"], "40% of cycles")

    def test_missing_base_rate_becomes_none(self):
        self.assertIsNone(sf.validate({"probability": 0.5})["base_rate"])

    def test_full_valid_payload(self):
        got = sf.validate(json.loads(GOOD))
        self.assertEqual(got["probability"], 0.35)
        self.assertEqual(got["confidence"], "medium")
        self.assertIsNone(got["rescaled_from"])
        self.assertEqual(len(got["key_drivers"]), 1)


# --------------------------------------------------------------------------
# usage_of
# --------------------------------------------------------------------------

class TestUsageOf(unittest.TestCase):
    def test_reads_token_counts(self):
        self.assertEqual(
            sf.usage_of(FakeResponse(GOOD, FakeUsage(9412, 388))),
            {"prompt_tokens": 9412, "completion_tokens": 388, "total_tokens": 9800},
        )

    def test_missing_usage_is_empty(self):
        resp = FakeResponse(GOOD)
        resp.usage = None
        self.assertEqual(sf.usage_of(resp), {})

    def test_no_usage_attribute(self):
        self.assertEqual(sf.usage_of(object()), {})


# --------------------------------------------------------------------------
# call — retry policy
# --------------------------------------------------------------------------

class TestCallRetries(unittest.TestCase):
    def setUp(self):
        # Keep the backoff arithmetic but never actually wait.
        self.slept: list[float] = []
        real_sleep = sf.time.sleep
        sf.time.sleep = self.slept.append
        self.addCleanup(lambda: setattr(sf.time, "sleep", real_sleep))

    def test_success_first_try(self):
        client = FakeClient([FakeResponse(GOOD)])
        resp = sf.call(client, "m", [], 10)
        self.assertEqual(resp.choices[0].message.content, GOOD)
        self.assertEqual(self.slept, [])

    def test_retries_429_then_succeeds(self):
        client = FakeClient([FakeError(429), FakeResponse(GOOD)])
        sf.call(client, "m", [], 10)
        self.assertEqual(len(self.slept), 1)
        self.assertEqual(len(client.calls), 2)

    def test_retries_5xx(self):
        client = FakeClient([FakeError(503), FakeError(500), FakeResponse(GOOD)])
        sf.call(client, "m", [], 10)
        self.assertEqual(len(client.calls), 3)

    def test_backoff_grows(self):
        client = FakeClient([FakeError(500), FakeError(500), FakeResponse(GOOD)])
        sf.call(client, "m", [], 10)
        self.assertLess(self.slept[0], self.slept[1])

    def test_gives_up_after_four_attempts(self):
        client = FakeClient([FakeError(429)] * 4)
        with self.assertRaises(FakeError):
            sf.call(client, "m", [], 10)
        self.assertEqual(len(client.calls), 4)

    def test_auth_error_not_retried(self):
        client = FakeClient([FakeError(401), FakeResponse(GOOD)])
        with self.assertRaises(FakeError):
            sf.call(client, "m", [], 10)
        self.assertEqual(len(client.calls), 1)

    def test_403_not_retried(self):
        client = FakeClient([FakeError(403), FakeResponse(GOOD)])
        with self.assertRaises(FakeError):
            sf.call(client, "m", [], 10)
        self.assertEqual(len(client.calls), 1)

    def test_connection_error_retried(self):
        """No status_code (e.g. APIConnectionError) is treated as retryable."""
        client = FakeClient([FakeError(None), FakeResponse(GOOD)])
        sf.call(client, "m", [], 10)
        self.assertEqual(len(client.calls), 2)

    def test_passes_model_and_timeout(self):
        client = FakeClient([FakeResponse(GOOD)])
        sf.call(client, "qwen3.6:35b", [{"role": "user", "content": "hi"}], 42)
        self.assertEqual(client.calls[0]["model"], "qwen3.6:35b")
        self.assertEqual(client.calls[0]["timeout"], 42)


# --------------------------------------------------------------------------
# run_one — the full per-model path
# --------------------------------------------------------------------------

class TestRunOne(unittest.TestCase):
    def test_clean_run(self):
        client = FakeClient([FakeResponse(GOOD)])
        r = sf.run_one(client, "qwen3.6:35b", "Will X?", "brief text", 10)
        self.assertEqual(r.status, "ok")
        self.assertEqual(r.probability, 0.35)
        self.assertEqual(r.attempts, 1)
        self.assertFalse(r.repaired)
        self.assertIsNone(r.error)
        self.assertEqual(r.usage["total_tokens"], 120)

    def test_raw_dropped_on_success(self):
        """README: raw is present on failed runs only."""
        client = FakeClient([FakeResponse(GOOD)])
        r = sf.run_one(client, "m", "Will X?", "", 10)
        self.assertIsNone(r.raw)

    def test_question_and_brief_reach_the_prompt(self):
        client = FakeClient([FakeResponse(GOOD)])
        sf.run_one(client, "m", "Will X happen?", "BRIEF-MARKER", 10)
        user = client.calls[0]["messages"][1]["content"]
        self.assertIn("Will X happen?", user)
        self.assertIn("BRIEF-MARKER", user)
        self.assertIn("RESEARCH BRIEF", user)

    def test_empty_brief_omits_section(self):
        client = FakeClient([FakeResponse(GOOD)])
        sf.run_one(client, "m", "Will X?", "", 10)
        self.assertNotIn("RESEARCH BRIEF", client.calls[0]["messages"][1]["content"])

    def test_repair_pass_recovers(self):
        client = FakeClient(
            [
                FakeResponse("I'm not able to give a number here.", FakeUsage(50, 10)),
                FakeResponse(GOOD, FakeUsage(80, 20)),
            ]
        )
        r = sf.run_one(client, "m", "Will X?", "", 10)
        self.assertEqual(r.status, "ok")
        self.assertTrue(r.repaired)
        self.assertEqual(r.attempts, 2)
        self.assertEqual(r.probability, 0.35)
        self.assertIsNone(r.raw)

    def test_repair_usage_is_summed(self):
        client = FakeClient(
            [
                FakeResponse("nope", FakeUsage(50, 10)),
                FakeResponse(GOOD, FakeUsage(80, 20)),
            ]
        )
        r = sf.run_one(client, "m", "Will X?", "", 10)
        self.assertEqual(r.usage["prompt_tokens"], 130)
        self.assertEqual(r.usage["completion_tokens"], 30)
        self.assertEqual(r.usage["total_tokens"], 160)

    def test_repair_prompt_shows_the_model_its_own_output(self):
        bad = "I decline to answer."
        client = FakeClient([FakeResponse(bad), FakeResponse(GOOD)])
        sf.run_one(client, "m", "Will X?", "", 10)
        repair_msgs = client.calls[1]["messages"]
        self.assertEqual(repair_msgs[-2]["role"], "assistant")
        self.assertEqual(repair_msgs[-2]["content"], bad)
        self.assertIn(bad, repair_msgs[-1]["content"])

    def test_both_attempts_bad_fails_with_raw(self):
        client = FakeClient([FakeResponse("no json here"), FakeResponse("still none")])
        r = sf.run_one(client, "m", "Will X?", "", 10)
        self.assertEqual(r.status, "failed")
        self.assertIsNone(r.probability)
        self.assertEqual(r.raw, "still none")
        self.assertIn("no JSON object found", r.error)
        self.assertTrue(r.repaired)

    def test_ambiguous_probability_survives_to_failure(self):
        """1.5 is rejected, and a repair pass returning it again stays failed."""
        payload = json.dumps({"probability": 1.5})
        client = FakeClient([FakeResponse(payload), FakeResponse(payload)])
        r = sf.run_one(client, "m", "Will X?", "", 10)
        self.assertEqual(r.status, "failed")
        self.assertIn("ambiguous", r.error)

    def test_rescale_recorded_on_success(self):
        client = FakeClient([FakeResponse(json.dumps({"probability": 73}))])
        r = sf.run_one(client, "m", "Will X?", "", 10)
        self.assertEqual(r.status, "ok")
        self.assertAlmostEqual(r.probability, 0.73)
        self.assertEqual(r.forecast["rescaled_from"], 73.0)

    def test_api_error_recorded_not_raised(self):
        client = FakeClient([FakeError(401, "invalid API key")])
        r = sf.run_one(client, "m", "Will X?", "", 10)
        self.assertEqual(r.status, "failed")
        self.assertIn("invalid API key", r.error)
        self.assertIsNone(r.probability)

    def test_empty_content_fails_cleanly(self):
        client = FakeClient([FakeResponse(None), FakeResponse("")])
        r = sf.run_one(client, "m", "Will X?", "", 10)
        self.assertEqual(r.status, "failed")
        self.assertIn("empty response body", r.error)

    def test_result_is_json_serialisable(self):
        """Every run has to survive asdict() into the output file."""
        ok = sf.run_one(FakeClient([FakeResponse(GOOD)]), "m", "Will X?", "", 10)
        bad = sf.run_one(FakeClient([FakeError(401)]), "m2", "Will X?", "", 10)
        json.dumps([asdict(ok), asdict(bad)])


# --------------------------------------------------------------------------
# load_dotenv
# --------------------------------------------------------------------------

class TestLoadDotenv(unittest.TestCase):
    def setUp(self):
        # Restore the real environment after each case.
        saved = dict(os.environ)

        def restore():
            os.environ.clear()
            os.environ.update(saved)

        self.addCleanup(restore)
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, True)

    def write(self, text: str) -> str:
        path = os.path.join(self.tmp, ".env")
        with open(path, "w", encoding="utf-8") as f:
            f.write(text)
        return path

    def test_reads_key_and_value(self):
        os.environ.pop("SOCLAAS_API_KEY", None)
        sf.load_dotenv(self.write("SOCLAAS_API_KEY=clsk_abc_123\n"))
        self.assertEqual(os.environ["SOCLAAS_API_KEY"], "clsk_abc_123")

    def test_returns_loaded_path(self):
        path = self.write("A=1\n")
        self.assertEqual(sf.load_dotenv(path), path)

    def test_missing_file_returns_none(self):
        self.assertIsNone(sf.load_dotenv(os.path.join(self.tmp, "nope.env")))

    def test_real_env_wins(self):
        """An exported value must not be silently overwritten by the file."""
        os.environ["SOCLAAS_API_KEY"] = "from_shell"
        sf.load_dotenv(self.write("SOCLAAS_API_KEY=from_file\n"))
        self.assertEqual(os.environ["SOCLAAS_API_KEY"], "from_shell")

    def test_comments_and_blanks_skipped(self):
        os.environ.pop("REAL", None)
        sf.load_dotenv(self.write("# a comment\n\n   \nREAL=yes\n"))
        self.assertEqual(os.environ["REAL"], "yes")

    def test_export_prefix_stripped(self):
        os.environ.pop("EXPORTED", None)
        sf.load_dotenv(self.write("export EXPORTED=value\n"))
        self.assertEqual(os.environ["EXPORTED"], "value")

    def test_quotes_stripped(self):
        os.environ.pop("DQ", None)
        os.environ.pop("SQ", None)
        sf.load_dotenv(self.write('DQ="double"\nSQ=\'single\'\n'))
        self.assertEqual(os.environ["DQ"], "double")
        self.assertEqual(os.environ["SQ"], "single")

    def test_hash_inside_value_preserved(self):
        """A '#' in a secret is a character, not a comment."""
        os.environ.pop("SECRET", None)
        sf.load_dotenv(self.write("SECRET=clsk_ab#cd\n"))
        self.assertEqual(os.environ["SECRET"], "clsk_ab#cd")

    def test_equals_inside_value_preserved(self):
        os.environ.pop("PADDED", None)
        sf.load_dotenv(self.write("PADDED=abc==\n"))
        self.assertEqual(os.environ["PADDED"], "abc==")

    def test_surrounding_whitespace_trimmed(self):
        os.environ.pop("SPACED", None)
        sf.load_dotenv(self.write("  SPACED = value  \n"))
        self.assertEqual(os.environ["SPACED"], "value")

    def test_line_without_equals_ignored(self):
        os.environ.pop("AFTER", None)
        sf.load_dotenv(self.write("this line has no equals sign\nAFTER=ok\n"))
        self.assertEqual(os.environ["AFTER"], "ok")

    def test_unmatched_quotes_left_alone(self):
        os.environ.pop("ODD", None)
        sf.load_dotenv(self.write("ODD=\"unclosed\n"))
        self.assertEqual(os.environ["ODD"], '"unclosed')


if __name__ == "__main__":
    unittest.main(verbosity=2)
