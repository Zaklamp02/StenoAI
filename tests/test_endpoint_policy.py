import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from click.testing import CliRunner

import simple_recorder
from src.config import Config
from src.endpoint_policy import InsecureEndpoint, require_secure_endpoint


class EndpointPolicyTests(unittest.TestCase):
    """F06: meeting text and credentials only travel encrypted, except to
    this machine."""

    def test_allowed(self):
        self.assertEqual(require_secure_endpoint("https://api.example.test/v1/"), "https://api.example.test/v1")
        self.assertEqual(require_secure_endpoint(" http://localhost:11434 "), "http://localhost:11434")
        self.assertEqual(require_secure_endpoint("http://127.0.0.1:8000"), "http://127.0.0.1:8000")
        self.assertEqual(require_secure_endpoint("http://127.4.5.6"), "http://127.4.5.6")
        self.assertEqual(require_secure_endpoint("http://[::1]:11434"), "http://[::1]:11434")
        self.assertEqual(require_secure_endpoint("HTTPS://API.Example.Test"), "HTTPS://API.Example.Test")
        self.assertEqual(require_secure_endpoint(""), "")

    def test_refused(self):
        for url in (
            "http://192.168.1.20:11434",
            "http://10.0.0.5",
            "http://org.example.invalid:8000",
            "http://localhost.attacker.test",
            "http://127.0.0.1.attacker.test",
            "http://[::2]",
            "https://user:secret@api.example.test",
            "https://@api.example.test",
            "ftp://api.example.test",
            "file:///etc/passwd",
            "api.example.test",
            "https://api.example.test:99999",
            "https://",
        ):
            with self.subTest(url=url), self.assertRaises(InsecureEndpoint):
                require_secure_endpoint(url)


class SetterTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.cfg = Config(config_path=Path(self._tmp.name) / "config.json")

    def test_setters_refuse_insecure_urls_and_keep_the_old_value(self):
        self.cfg.set_cloud_api_url("https://api.example.test/v1")
        with self.assertRaises(InsecureEndpoint):
            self.cfg.set_cloud_api_url("http://192.168.1.20/v1")
        self.assertEqual(self.cfg.get_cloud_api_url(), "https://api.example.test/v1")
        with self.assertRaises(InsecureEndpoint):
            self.cfg.set_remote_ollama_url("http://192.168.1.20:11434")
        self.assertTrue(self.cfg.set_remote_ollama_url("http://localhost:11434"))

    def test_cli_reports_the_refusal(self):
        with mock.patch("src.config.get_config", return_value=self.cfg):
            result = CliRunner().invoke(simple_recorder.set_cloud_api_url, ["http://10.0.0.5/v1"])
        self.assertNotEqual(result.exit_code, 0)
        out = json.loads([ln for ln in result.output.splitlines() if ln.startswith("{")][-1])
        self.assertFalse(out["success"])
        self.assertIn("https", out["error"])


class SummarizerUseTests(unittest.TestCase):
    """A value saved before the rule existed is refused where it is used."""

    def _config(self, **values):
        cfg = mock.MagicMock()
        cfg.get_ai_provider.return_value = values.get("provider", "cloud")
        cfg.get_remote_ollama_url.return_value = values.get("remote", "")
        cfg.get_cloud_api_url.return_value = values.get("cloud_url", "")
        cfg.get_cloud_api_key.return_value = "FAKE-KEY"
        cfg.get_cloud_provider.return_value = "custom"
        cfg.get_cloud_model.return_value = "model"
        cfg.get_adapter_url.return_value = values.get("adapter", "")
        cfg.get_adapter_token.return_value = "FAKE-TOKEN"
        return cfg

    def _build(self, cfg):
        from src.summarizer import OllamaSummarizer
        return OllamaSummarizer(ai_provider=cfg.get_ai_provider(), config=cfg)

    def test_legacy_http_cloud_url_is_refused(self):
        with self.assertRaises(InsecureEndpoint):
            self._build(self._config(cloud_url="http://10.0.0.5/v1"))

    def test_legacy_http_adapter_url_is_refused(self):
        with self.assertRaises(InsecureEndpoint):
            self._build(self._config(provider="adapter", adapter="http://org.example.invalid"))

    def test_an_unused_legacy_remote_url_does_not_break_local(self):
        cfg = self._config(provider="local", remote="http://10.0.0.5:11434")
        try:
            self._build(cfg)
        except InsecureEndpoint:
            self.fail("the local provider must not be blocked by an unused remote URL")
        except Exception:
            pass  # local Ollama is not running in tests; any other failure is unrelated


if __name__ == "__main__":
    unittest.main()
