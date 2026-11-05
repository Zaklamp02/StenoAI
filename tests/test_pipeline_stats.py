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
            "mic_segments", "mic_segments_dropped_as_echo", "channel_bleed_collapsed",
            "clusters_raw", "clusters_after_fold", "cross_channel_pairs",
            "cross_channel_merges", "cross_channel_nearest_unmerged",
            "cross_channel_skipped_erase_split", "echo_turns_dropped",
        })
        self.assertNotIn("Jitze", json.dumps(stats))
        self.assertNotIn("budget", json.dumps(stats))

    def test_copies_bleed_and_merge_counts(self):
        stats = self._stats({
            "pipeline_diagnostics": {
                "mic_segments": 40,
                "mic_segments_dropped_as_echo": 12,
                "channel_bleed_collapsed": False,
                "clusters_raw": {"mic": 3, "system": 2},
                "clusters_after_fold": {"mic": 2, "system": 2},
                "cross_channel_pairs": 4,
                "cross_channel_merges": [
                    {"tier": "echo", "distance": 0.31, "overlap": 0.92},
                    {"tier": "made-up", "distance": 0.1},
                ],
                "cross_channel_nearest_unmerged": {"distance": 0.47, "overlap": 0.55},
                "echo_turns_dropped": 5,
                "segment_texts": ["should never be copied"],
            },
        })
        self.assertEqual(stats["mic_segments_dropped_as_echo"], 12)
        self.assertEqual(stats["clusters_raw"], {"mic": 3, "system": 2})
        self.assertEqual(stats["cross_channel_merges"], [
            {"tier": "echo", "distance": 0.31, "overlap": 0.92},
        ])
        self.assertEqual(stats["cross_channel_nearest_unmerged"], {"distance": 0.47, "overlap": 0.55})
        self.assertNotIn("segment_texts", stats)
        self.assertNotIn("should never", json.dumps(stats))

    def test_missing_diagnostics_read_as_zero(self):
        stats = self._stats({})
        self.assertEqual(stats["mic_segments"], 0)
        self.assertEqual(stats["cross_channel_merges"], [])
        self.assertIsNone(stats["cross_channel_nearest_unmerged"])

    def test_unknown_source_is_not_forwarded(self):
        self.assertEqual(self._stats({}, source="something else")["source"], "unknown")


if __name__ == "__main__":
    unittest.main()
