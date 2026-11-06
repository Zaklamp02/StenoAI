"""R1/R2 from the 2026-11-06 security recheck.

R1: the OpenAI and Anthropic SDKs and the Ollama client follow redirects by
default. Anthropic keeps its x-api-key header across origins and a 307/308
resends the body (the meeting text), so a redirecting provider could move
both to another origin, plain http included. Every provider client is now
built without redirects (src/secure_http.py).

R2: title generation logged the raw exception with its traceback, and
Ollama server text was trusted as our own.

These drive the real summariser constructor and generate_title against two
loopback servers: A answers with a redirect to B, and B records anything
that reaches it.
"""

import http.server
import json
import os
import re
import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock

import httpx

from src.config import Config
from src.endpoint_policy import cloud_key_destination
from src.provider_errors import safe_error_text

SECRET = "CONFIDENTIAL_AUDIT_SENTENCE about the board's merger"
KEY = "sk-ant-AUDITFAKEKEY1234567890"
REDIRECTS = (301, 302, 303, 307, 308)
ROOT = Path(__file__).resolve().parent.parent


class _Server:
    def __init__(self, handler):
        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.origin = f"http://127.0.0.1:{self.server.server_address[1]}"

    def close(self):
        self.server.shutdown()
        self.server.server_close()


def _collector():
    received = []

    class Collector(http.server.BaseHTTPRequestHandler):
        def _record(self):
            length = int(self.headers.get("content-length") or 0)
            received.append({
                "headers": dict(self.headers),
                "body": self.rfile.read(length).decode("utf-8", "replace") if length else "",
            })
            body = b'{"error": "unexpected"}'
            self.send_response(500)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        do_GET = do_POST = _record

        def log_message(self, *args):
            pass

    return Collector, received


def _redirector(status, target_origin):
    class Redirect(http.server.BaseHTTPRequestHandler):
        def _redirect(self):
            length = int(self.headers.get("content-length") or 0)
            if length:
                self.rfile.read(length)
            self.send_response(status)
            self.send_header("location", target_origin + self.path)
            self.send_header("content-length", "0")
            self.end_headers()

        do_GET = do_POST = _redirect

        def log_message(self, *args):
            pass

    return Redirect


class ProviderRedirectTests(unittest.TestCase):
    """No provider client follows a redirect, so B never sees prompt or key."""

    def setUp(self):
        handler, self.received = _collector()
        self.target = _Server(handler)
        self.addCleanup(self.target.close)
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        sleep = mock.patch("src.summarizer.time.sleep")
        sleep.start()
        self.addCleanup(sleep.stop)

    def _provider(self, status):
        server = _Server(_redirector(status, self.target.origin))
        self.addCleanup(server.close)
        return server.origin

    def _config(self):
        return Config(config_path=Path(self._tmp.name) / f"config-{len(os.listdir(self._tmp.name))}.json")

    def _title(self, summarizer):
        with self.assertLogs(level="INFO") as logs:
            title = summarizer.generate_title(f"Summary: {SECRET}", f"Transcript: {SECRET}")
        self.assertIsNone(title)
        return "\n".join(logs.output)

    def _assert_nothing_forwarded(self, log_text):
        self.assertEqual(self.received, [], "a redirect was followed to another origin")
        self.assertNotIn("CONFIDENTIAL", log_text)
        self.assertNotIn("AUDITFAKE", log_text)

    def test_openai_compatible_client(self):
        from src.summarizer import OllamaSummarizer
        for status in REDIRECTS:
            with self.subTest(status=status):
                cfg = self._config()
                cfg.set_ai_provider("cloud")
                cfg.set_cloud_provider("custom")
                cfg.set_cloud_api_url(self._provider(status) + "/v1")
                env = {
                    "STENOAI_CLOUD_API_KEY": KEY,
                    "STENOAI_CLOUD_KEY_DESTINATION": cloud_key_destination("custom", cfg.get_cloud_api_url(), ""),
                }
                with mock.patch.dict(os.environ, env):
                    summarizer = OllamaSummarizer(model_name="m", config=cfg)
                self._assert_nothing_forwarded(self._title(summarizer))

    def test_anthropic_client(self):
        from src import endpoint_policy
        from src.summarizer import OllamaSummarizer
        for status in REDIRECTS:
            with self.subTest(status=status):
                origin = self._provider(status)
                with mock.patch.dict(endpoint_policy.FIRST_PARTY_ORIGINS, {"anthropic": origin}):
                    cfg = self._config()
                    cfg.set_ai_provider("cloud")
                    cfg.set_cloud_provider("anthropic")
                    env = {
                        "STENOAI_CLOUD_API_KEY": KEY,
                        "STENOAI_CLOUD_KEY_DESTINATION": cloud_key_destination("anthropic", "", ""),
                    }
                    with mock.patch.dict(os.environ, env):
                        summarizer = OllamaSummarizer(model_name="m", config=cfg)
                    self._assert_nothing_forwarded(self._title(summarizer))

    def test_remote_ollama_client(self):
        from src.summarizer import OllamaSummarizer
        for status in REDIRECTS:
            with self.subTest(status=status):
                cfg = self._config()
                cfg.set_ai_provider("remote")
                cfg.set_remote_ollama_url(self._provider(status))
                summarizer = OllamaSummarizer(model_name="m", config=cfg)
                self._assert_nothing_forwarded(self._title(summarizer))

    def test_a_same_origin_redirect_is_not_followed_either(self):
        from src.secure_http import openai_client
        server = _Server(_redirector(307, "http://127.0.0.1:1"))
        self.addCleanup(server.close)
        client = openai_client(KEY, server.origin + "/v1").with_options(max_retries=0)
        import openai
        with self.assertRaises(openai.APIStatusError) as raised:
            client.models.list()
        self.assertEqual(raised.exception.status_code, 307)


class ClientConstructionTripwireTests(unittest.TestCase):
    """New call sites must use the redirect-free builders in src/secure_http.py."""

    PATTERN = re.compile(r"\b(?:OpenAI|Anthropic|AsyncOpenAI|AsyncAnthropic)\(|\bollama(?:_pkg)?\.(?:Async)?Client\(")

    def test_no_direct_provider_clients(self):
        offenders = []
        for path in [ROOT / "simple_recorder.py", *sorted((ROOT / "src").glob("*.py"))]:
            if path.name == "secure_http.py":
                continue
            for number, line in enumerate(path.read_text().splitlines(), 1):
                if self.PATTERN.search(line.split("#", 1)[0]):
                    offenders.append(f"{path.name}:{number}: {line.strip()}")
        self.assertEqual(offenders, [])


class TitleErrorLoggingTests(unittest.TestCase):
    """R2: a failed title logs class and status, never the provider's text."""

    def test_sdk_error_text_and_traceback_stay_out_of_the_log(self):
        import openai
        from src.summarizer import OllamaSummarizer
        request = httpx.Request("POST", "https://api.openai.com/v1/chat/completions")
        response = httpx.Response(400, request=request, json={"error": {"message": f"{SECRET} key {KEY}"}})
        error = openai.BadRequestError(f"Error code: 400 - {SECRET} {KEY}", response=response, body=response.json())

        summarizer = OllamaSummarizer.__new__(OllamaSummarizer)
        summarizer.ai_provider = "cloud"
        summarizer.cloud_provider = "openai"
        summarizer.model_name = "m"
        summarizer.ollama_process = None
        summarizer.cloud_client = mock.Mock()
        summarizer.cloud_client.chat.completions.create.side_effect = error
        with mock.patch("src.summarizer.time.sleep"), self.assertLogs(level="INFO") as logs:
            self.assertIsNone(summarizer.generate_title(f"Summary: {SECRET}", "t"))
        text = "\n".join(logs.output)
        self.assertIn("BadRequestError (HTTP 400)", text)
        self.assertNotIn("CONFIDENTIAL", text)
        self.assertNotIn("AUDITFAKE", text)
        self.assertNotIn("Traceback", text)


class OllamaServerTextTests(unittest.TestCase):
    """R2: the Ollama server's error text is provider-controlled."""

    def test_arbitrary_server_text_is_reduced(self):
        import ollama
        error = ollama.ResponseError(json.dumps({"error": f"echo: {SECRET}"}), 500)
        self.assertEqual(safe_error_text(error), "ResponseError (HTTP 500)")

    def test_the_shapes_the_shell_classifies_keep_fixed_wording(self):
        import ollama
        memory = ollama.ResponseError(
            f"model requires more system memory (10.5 GiB) than is available (8.0 GiB) {SECRET}", 500)
        missing = ollama.ResponseError(f"model '{SECRET}' not found, try pulling it first", 404)
        self.assertEqual(safe_error_text(memory),
                         "Ollama: model requires more system memory than is available (HTTP 500)")
        self.assertEqual(safe_error_text(missing), "Ollama could not find model (HTTP 404)")

    def test_unknown_status_is_left_out(self):
        import ollama
        self.assertEqual(safe_error_text(ollama.ResponseError(SECRET)), "ResponseError")


class BuiltinExceptionOriginTests(unittest.TestCase):
    """R2: a built-in exception keeps its text only when our code wrote it."""

    @staticmethod
    def _raise_in(module_name, error):
        scope = {"__name__": module_name, "error": error}
        exec("def go():\n    raise error\n", scope)
        try:
            scope["go"]()
        except BaseException as raised:
            return raised
        raise AssertionError("did not raise")

    def test_raised_by_a_library(self):
        error = self._raise_in("somelibrary.client", ValueError(f"bad response: {SECRET}"))
        self.assertEqual(safe_error_text(error), "ValueError")

    def test_raised_by_our_code(self):
        error = self._raise_in("src.summarizer", RuntimeError("Org adapter rejected the request (401)."))
        self.assertEqual(safe_error_text(error), "Org adapter rejected the request (401).")

    def test_subclasses_that_quote_data_are_reduced(self):
        try:
            b"\xff".decode("utf-8")
        except UnicodeDecodeError as error:
            self.assertEqual(safe_error_text(error), "UnicodeDecodeError")


if __name__ == "__main__":
    unittest.main()
