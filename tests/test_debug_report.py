import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from click.testing import CliRunner

import simple_recorder
from src.config import Config
from src.pipeline_stats import pipeline_stats_path
from src.speaker_suggestions import write_speakers_sidecar


def _last_json(output):
    line = [ln for ln in output.splitlines() if ln.strip().startswith("{")][-1]
    return json.loads(line)


class DebugReportTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = self._tmp.name
        self.output = Path(self.tmp) / "output"
        self.output.mkdir()
        self.cfg = Config(config_path=Path(self.tmp) / "config.json")
        self.cfg.set_identity_matching_enabled(True)

    def tearDown(self):
        self._tmp.cleanup()

    def _report(self, stem="mtg001"):
        with mock.patch("src.config.get_config", return_value=self.cfg), \
             mock.patch.dict("os.environ", {"STENOAI_USER_DATA_DIR": self.tmp}):
            result = CliRunner().invoke(simple_recorder.debug_report, [stem])
        return result, _last_json(result.output)

    def test_reports_clusters_distances_and_pipeline_without_content(self):
        write_speakers_sidecar(self.output, "mtg001", {
            "mic": {"recording_type": "in_person", "clusters": {
                "SPEAKER_00": {"embedding": [1.0, 0.0], "speech_duration_seconds": 30.0, "segment_count": 6,
                               "segments": [{"start": 1.0, "end": 31.0}]},
                "SPEAKER_01": {"embedding": [0.0, 1.0], "speech_duration_seconds": 9.0, "segment_count": 7},
            }},
            "system": {"recording_type": "remote", "clusters": {
                "SPEAKER_00": {"embedding": [0.6, 0.8], "speech_duration_seconds": 50.0, "segment_count": 10},
            }},
        })
        pipeline_stats_path(self.output, "mtg001").write_text(json.dumps({"mic_segments": 12}))
        person = self.cfg.create_person_profile("Jitze Example")
        self.assertTrue(person)

        result, out = self._report()
        self.assertEqual(result.exit_code, 0, result.output)
        report = out["report"]
        mic = report["speakers"]["channels"]["mic"]
        self.assertEqual([c["cluster"] for c in mic["clusters"]], ["C1", "C2"])
        self.assertEqual(mic["clusters"][1]["avg_turn_seconds"], 1.29)
        # No known person has evidence yet, so nothing was scored.
        self.assertEqual(mic["clusters"][1]["blocked_by"], {})
        self.assertEqual(report["speakers"]["known_people"], 0)
        self.assertEqual(mic["distances"], [{"a": "C1", "b": "C2", "distance": 1.0}])
        self.assertEqual(len(report["speakers"]["cross_channel_distances"]), 2)
        self.assertEqual(report["pipeline"], {"mic_segments": 12})
        self.assertIn("suggestion_distance", report["thresholds"])

        dumped = json.dumps(report)
        for secret in ("Jitze", "SPEAKER_0", "mtg001", self.tmp, '"segments"', '"start"'):
            self.assertNotIn(secret, dumped)

    def test_a_meeting_without_speaker_data_still_reports_settings(self):
        result, out = self._report("nothing-here")
        self.assertEqual(result.exit_code, 0, result.output)
        self.assertIsNone(out["report"]["speakers"])
        self.assertIsNone(out["report"]["pipeline"])
        self.assertIn("transcription_engine", out["report"]["settings"])

    def test_rejects_a_path_as_meeting_identifier(self):
        result, out = self._report("../secrets")
        self.assertNotEqual(result.exit_code, 0)
        self.assertFalse(out["success"])


if __name__ == "__main__":
    unittest.main()
