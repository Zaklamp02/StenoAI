import http.server
import json
import os
import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock

from click.testing import CliRunner

import simple_recorder
from src.config import Config
from src.endpoint_policy import CLOUD_KEY_REENTER_MESSAGE, cloud_key_destination

CASES = json.loads((Path(__file__).parent / "fixtures" / "cloud_key_destinations.json").read_text())


class DestinationTableTests(unittest.TestCase):
    """Shared with app/cloud-key-store.test.js: both sides must agree."""

    def test_destinations_match_the_shared_table(self):
        for case in CASES:
            with self.subTest(case=case):
                self.assertEqual(
                    cloud_key_destination(case["provider"], case["cloud_api_url"], case["bedrock_region"]),
                    case["destination"],
                )


class _ModelsServer:
    """A loopback OpenAI-compatible server that records what it receives."""

    def __init__(self):
        self.authorizations = []
        received = self.authorizations

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                received.append(self.headers.get("authorization"))
                body = json.dumps({"object": "list", "data": [{"id": "m", "object": "model", "created": 1, "owned_by": "x"}]}).encode()
                self.send_response(200)
                self.send_header("content-type", "application/json")
                self.send_header("content-length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *args):
                pass

        self.server = http.server.HTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}/v1"
        self.origin = f"http://127.0.0.1:{self.server.server_address[1]}"

    def close(self):
        self.server.shutdown()
        self.server.server_close()


class KeyBindingTests(unittest.TestCase):
    """F04: a key entered for one destination never reaches another."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.cfg = Config(config_path=Path(self._tmp.name) / "config.json")
        self.cfg.set_cloud_provider("custom")
        self.a = _ModelsServer()
        self.b = _ModelsServer()
        self.addCleanup(self.a.close)
        self.addCleanup(self.b.close)

    def _env(self, destination):
        return {"STENOAI_CLOUD_API_KEY": "sk-FAKE-KEY-FOR-A", "STENOAI_CLOUD_KEY_DESTINATION": destination}

    def _test_cloud_api(self, env):
        with mock.patch("src.config.get_config", return_value=self.cfg), mock.patch.dict(os.environ, env):
            result = CliRunner().invoke(simple_recorder.test_cloud_api, [])
        return json.loads([ln for ln in result.output.splitlines() if ln.startswith("{")][-1])

    def test_the_key_reaches_the_destination_it_was_bound_to(self):
        self.cfg.set_cloud_api_url(self.a.url)
        out = self._test_cloud_api(self._env(f"custom|{self.a.origin}"))
        self.assertTrue(out["success"], out)
        self.assertEqual(self.a.authorizations, ["Bearer sk-FAKE-KEY-FOR-A"])

    def test_after_an_endpoint_change_the_other_server_receives_nothing(self):
        # The key was bound to A; the config now names B (changed later, or
        # while the job was starting).
        self.cfg.set_cloud_api_url(self.b.url)
        out = self._test_cloud_api(self._env(f"custom|{self.a.origin}"))
        self.assertFalse(out["success"])
        self.assertEqual(out["error"], CLOUD_KEY_REENTER_MESSAGE)
        self.assertEqual(self.b.authorizations, [])
        self.assertEqual(self.a.authorizations, [])

    def test_a_port_change_on_the_same_host_also_withholds_the_key(self):
        self.cfg.set_cloud_api_url(self.b.url)
        with mock.patch.dict(os.environ, self._env(f"custom|{self.a.origin}")):
            self.assertEqual(self.cfg.get_cloud_api_key(), "")
            self.assertTrue(self.cfg.cloud_key_bound_elsewhere())

    def test_a_key_without_a_destination_is_never_used(self):
        self.cfg.set_cloud_api_url(self.a.url)
        with mock.patch.dict(os.environ, {"STENOAI_CLOUD_API_KEY": "sk-FAKE"}, clear=False):
            os.environ.pop("STENOAI_CLOUD_KEY_DESTINATION", None)
            self.assertEqual(self.cfg.get_cloud_api_key(), "")

    def test_switching_from_custom_to_openai_withholds_a_custom_key(self):
        self.cfg.set_cloud_api_url(self.a.url)
        self.cfg.set_cloud_provider("openai")
        with mock.patch.dict(os.environ, self._env(f"custom|{self.a.origin}")):
            self.assertEqual(self.cfg.get_cloud_api_key(), "")

    def test_the_summarizer_refuses_with_the_reenter_message(self):
        from src.summarizer import OllamaSummarizer
        self.cfg.set_cloud_api_url(self.b.url)
        self.cfg.set_ai_provider("cloud")
        with mock.patch.dict(os.environ, self._env(f"custom|{self.a.origin}")):
            with self.assertRaises(ValueError) as raised:
                OllamaSummarizer(ai_provider="cloud", config=self.cfg)
        self.assertEqual(str(raised.exception), CLOUD_KEY_REENTER_MESSAGE)
        self.assertEqual(self.b.authorizations, [])

    def test_first_party_clients_ignore_base_url_overrides_in_the_environment(self):
        from src.summarizer import OllamaSummarizer
        self.cfg.set_cloud_provider("openai")
        self.cfg.set_ai_provider("cloud")
        env = {**self._env("openai|https://api.openai.com"), "OPENAI_BASE_URL": self.b.url}
        with mock.patch.dict(os.environ, env):
            summarizer = OllamaSummarizer(ai_provider="cloud", config=self.cfg)
        self.assertEqual(str(summarizer.cloud_client.base_url).rstrip("/"), "https://api.openai.com/v1")


if __name__ == "__main__":
    unittest.main()
