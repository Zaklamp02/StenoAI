import json
import unittest

from src.pipeline_stats import pipeline_stats


class PipelineStatsTests(unittest.TestCase):
    def _stats(self, transcript_data, **overrides):
        kwargs = {
            "source": "batch",
            "diarization_engine": "nemotron3",
            "speaker_identification": True,
        }
        kwargs.update(overrides)
        return pipeline_stats(transcript_data, **kwargs)

    def test_counts_distinct_speakers_per_channel(self):
        stats = self._stats({
            "is_diarised": True,
            "duration_seconds": 1830.5,
            "window_coverage": 0.97,
            "turn_manifest": [
                {"start": 0, "channel": "mic", "diarization_speaker_id": "0"},
                {"start": 4, "channel": "system", "diarization_speaker_id": "0"},
                {"start": 9, "channel": "system", "diarization_speaker_id": "1"},
                {"start": 12, "channel": "mic", "diarization_speaker_id": "0"},
                {"start": 15, "channel": "system", "diarization_speaker_id": None},
            ],
        })
        self.assertEqual(stats["mic_speakers"], 1)
        self.assertEqual(stats["system_speakers"], 2)
        self.assertTrue(stats["dual_channel"])
        self.assertTrue(stats["diarised"])
        self.assertEqual(stats["window_coverage"], 0.97)
        self.assertEqual(stats["duration_seconds"], 1830.5)

    def test_live_fallback_without_manifest(self):
        stats = self._stats(
            {"transcript_text": "secret words", "is_diarised": False},
            source="live",
            diarization_engine=None,
            speaker_identification=False,
        )
        self.assertEqual(stats["source"], "live")
        self.assertEqual(stats["mic_speakers"], 0)
        self.assertFalse(stats["dual_channel"])
        self.assertIsNone(stats["window_coverage"])
        self.assertIsNone(stats["diarization_engine"])

    def test_never_carries_content(self):
        stats = self._stats({
            "transcript_text": "Jitze said the budget is final",
            "diarised_text": "[00:00] Jitze: the budget is final",
            "speaker_clusters": {"mic": {"clusters": {"0": {"embedding": [0.1]}}}},
            "turn_manifest": [{"start": 0, "channel": "mic", "diarization_speaker_id": "Jitze"}],
        })
        self.assertEqual(set(stats), {
            "source", "diarised", "dual_channel", "mic_speakers", "system_speakers",
            "window_coverage", "duration_seconds", "diarization_engine", "speaker_identification",
        })
        self.assertNotIn("Jitze", json.dumps(stats))
        self.assertNotIn("budget", json.dumps(stats))

    def test_unknown_source_is_not_forwarded(self):
        self.assertEqual(self._stats({}, source="something else")["source"], "unknown")


if __name__ == "__main__":
    unittest.main()
