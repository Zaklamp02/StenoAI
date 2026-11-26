import contextlib
import io
import json
import os
import sys
import tempfile
import unittest
from unittest.mock import patch

import numpy as np

from src import sherpa_diarize as sd
from src.transcriber import SHERPA_DIARIZE, _speech_regions_option, _steno_diarize_argv


def _voices(count, per_voice, noise=0.05, seed=0):
    """``per_voice`` noisy unit vectors around each of ``count`` orthogonal voices."""
    rng = np.random.default_rng(seed)
    vectors = []
    for voice in range(count):
        base = np.zeros(16)
        base[voice] = 1.0
        vectors.extend(base + noise * rng.standard_normal(16) for _ in range(per_voice))
    return np.asarray(vectors)


class SherpaDiarizeLogicTests(unittest.TestCase):
    def test_centroid_is_normalised_mean(self):
        np.testing.assert_allclose(sd.centroid([[1.0, 0.0], [0.0, 1.0]]), [2 ** -0.5, 2 ** -0.5])

    def test_speech_regions_are_clipped_sorted_and_merged(self):
        with patch.dict(os.environ, {sd.REGIONS_ENV: "[[20, 30], [-1, 5], [4, 8], [95, 120]]"}):
            self.assertEqual(sd.speech_regions(100.0), [(0.0, 8.0), (20.0, 30.0), (95.0, 100.0)])
        with patch.dict(os.environ, {sd.REGIONS_ENV: "not json"}):
            self.assertEqual(sd.speech_regions(100.0), [])

    def test_restore_times_maps_back_and_splits_at_joins(self):
        # Regions 10-20 s and 50-60 s were diarized as one 20 s stretch.
        regions = [(10.0, 20.0), (50.0, 60.0)]
        segments = [(1.0, 3.0, "SPEAKER_0"), (8.0, 12.0, "SPEAKER_1")]
        self.assertEqual(sd.restore_times(segments, regions), [
            (11.0, 13.0, "SPEAKER_0"), (18.0, 20.0, "SPEAKER_1"), (50.0, 52.0, "SPEAKER_1"),
        ])

    def test_centroid_linkage_separates_distinct_voices(self):
        labels = sd.centroid_linkage(_voices(3, 10), sd.CLUSTER_THRESHOLD)
        self.assertEqual(len(set(labels)), 3)
        for voice in range(3):
            self.assertEqual(len(set(labels[voice * 10:(voice + 1) * 10])), 1)

    def test_cluster_gives_stray_and_noisy_embeddings_to_a_real_speaker(self):
        vectors = np.vstack([_voices(2, 20), [np.eye(16)[5]]])  # one stray voice
        clean = np.full(len(vectors), 4.0)
        clean[:3] = 0.5  # too little solo speech to vote
        assignment = sd.cluster(vectors, clean)
        self.assertEqual(len(set(assignment)), 2)
        self.assertEqual(len(set(assignment[:20])), 1)
        self.assertEqual(len(set(assignment[20:40])), 1)

    def test_cluster_keeps_both_speakers_of_a_short_recording(self):
        # 5 embeddings each: under MIN_CLUSTER_SIZE, but a short recording
        # only asks for an eighth of the voting embeddings.
        self.assertEqual(len(set(sd.cluster(_voices(2, 5), np.full(10, 4.0)))), 2)

    def test_local_speaker_audio_prefers_solo_speech(self):
        samples = np.arange(sd.WINDOW_SAMPLES, dtype=np.float32)
        active = np.zeros(sd.WINDOW_FRAMES, dtype=bool)
        active[100:300] = True
        alone = np.ones(sd.WINDOW_FRAMES, dtype=bool)
        alone[200:300] = False  # someone talks over the second half
        audio, clean_s = sd.local_speaker_audio(samples, 0, active, alone)
        self.assertEqual(audio[0], 100 * sd.FRAME_SAMPLES)
        self.assertEqual(len(audio), 100 * sd.FRAME_SAMPLES)
        self.assertAlmostEqual(clean_s, 100 * sd.FRAME_SAMPLES / sd.SAMPLE_RATE)
        # A blip is not embedded at all.
        active[:] = False
        active[5:8] = True
        self.assertIsNone(sd.local_speaker_audio(samples, 0, active, alone)[0])

    def test_reconstruct_agrees_across_windows_and_keeps_overlap(self):
        starts = np.array([0, sd.WINDOW_STEP_FRAMES * sd.FRAME_SAMPLES])
        activity = np.zeros((2, sd.WINDOW_FRAMES, sd.LOCAL_SPEAKERS), dtype=bool)
        activity[0, 0:300, 0] = True      # speaker A, 0 - ~5 s
        activity[0, 250:500, 1] = True    # speaker B, overlapping A
        # The second window starts 148 frames later and sees the same speech
        # under swapped local indices.
        activity[1, 0:300 - 148, 1] = True
        activity[1, 250 - 148:500 - 148, 0] = True
        speaker_of = {(0, 0): 0, (0, 1): 1, (1, 1): 0, (1, 0): 1}
        total = int(starts[-1]) + sd.WINDOW_SAMPLES
        segments = sd.reconstruct(total, starts, activity, speaker_of)
        frame_s = sd.FRAME_SAMPLES / sd.SAMPLE_RATE
        self.assertEqual([spk for _, _, spk in segments], ["SPEAKER_0", "SPEAKER_1"])
        (a_start, a_end, _), (b_start, b_end, _) = segments
        self.assertAlmostEqual(a_start, 0.0)
        self.assertAlmostEqual(a_end, 300 * frame_s, places=3)
        self.assertAlmostEqual(b_start, 250 * frame_s, places=3)
        self.assertAlmostEqual(b_end, 500 * frame_s, places=3)


class SherpaDiarizeCliTests(unittest.TestCase):
    def test_model_status_and_diarize_exit_3_until_models_exist(self):
        with tempfile.TemporaryDirectory() as tmp, \
                patch.dict(os.environ, {"STENOAI_DIARIZE_MODEL_DIR": tmp}):
            for argv in (["model-status"], ["diarize", "meeting.wav"]):
                out = io.StringIO()
                with contextlib.redirect_stdout(out):
                    self.assertEqual(sd.main(argv), 3)
                status = json.loads(out.getvalue())
                self.assertFalse(status["ready"])
                self.assertEqual(status["missing_models"], list(sd.MODELS))
            for name in sd.MODELS:
                open(os.path.join(tmp, name), "wb").close()
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(sd.main(["model-status"]), 0)

    def test_sentinel_runs_the_python_sidecar(self):
        self.assertEqual(_steno_diarize_argv("/bin/steno-diarize", "x"), ["/bin/steno-diarize", "x"])
        with patch.object(sys, "frozen", True, create=True):
            self.assertEqual(
                _steno_diarize_argv(SHERPA_DIARIZE, "model-status"),
                [sys.executable, "diarize-sidecar", "model-status"],
            )

    def test_transcript_segments_become_padded_merged_regions(self):
        segments = [{"start": 30.0, "end": 31.0}, {"start": 10.0, "end": 12.0}, {"start": 13.0, "end": 15.0}]
        with patch.object(sys, "platform", "linux"):
            env = _speech_regions_option(segments)["extra_env"]
        self.assertEqual(json.loads(env[sd.REGIONS_ENV]), [[9.5, 15.5], [29.5, 31.5]])
        # The Swift sidecar's call is left exactly as it was.
        with patch.object(sys, "platform", "darwin"):
            self.assertEqual(_speech_regions_option(segments), {})


if __name__ == "__main__":
    unittest.main()
