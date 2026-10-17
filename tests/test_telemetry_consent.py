import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from src.config import Config


class TelemetryConsentTests(unittest.TestCase):
    def test_new_and_legacy_default_on_configs_need_explicit_consent(self):
        for legacy in (False, True):
            with self.subTest(legacy=legacy), tempfile.TemporaryDirectory() as directory:
                with patch.dict(os.environ, {"STENOAI_USER_DATA_DIR": directory}):
                    path = Path(directory) / "config.json"
                    if legacy:
                        path.write_text(json.dumps({"telemetry_enabled": True}))
                    config = Config(config_path=path)
                    self.assertFalse(config.get_telemetry_enabled())
                    self.assertTrue(config.set_telemetry_enabled(True))
                    self.assertTrue(Config(config_path=path).get_telemetry_enabled())
                    self.assertTrue(config.set_telemetry_enabled(False))
                    self.assertFalse(Config(config_path=path).get_telemetry_enabled())
