import importlib.util
import subprocess
import sys
import unittest

import numpy as np

from src import silero_vad
from src.silero_vad import VAD_CHUNK_SAMPLES, VAD_SAMPLE_RATE, _NumpySilero


def _onnxruntime_usable() -> bool:
    """Installed AND working. Probed in a child process: an onnxruntime built
    for NumPy 1.x half-imports under NumPy 2 (errors on stderr, exit 0), then
    fails on first use and can crash later tests in the same interpreter."""
    if not importlib.util.find_spec("onnxruntime"):
        return False
    probe = subprocess.run(
        [sys.executable, "-c", "from src.silero_vad import _OnnxSilero; _OnnxSilero()"],
        capture_output=True, text=True,
    )
    return probe.returncode == 0 and "Error" not in probe.stderr


def _signal(seconds: float = 6.0) -> np.ndarray:
    """Silence, a voiced harmonic sweep, noise, and silence again -- enough to
    drive the model's probability across its full range."""
    rng = np.random.default_rng(0)
    n = int(seconds * VAD_SAMPLE_RATE)
    t = np.arange(n) / VAD_SAMPLE_RATE
    f0 = 120 + 60 * np.sin(2 * np.pi * 0.7 * t)
    phase = 2 * np.pi * np.cumsum(f0) / VAD_SAMPLE_RATE
    voiced = sum(np.sin(k * phase) / k for k in range(1, 12)) * (0.5 + 0.5 * np.sin(2 * np.pi * 3 * t))
    out = np.zeros(n, dtype=np.float32)
    q = n // 4
    out[q : 2 * q] = 0.3 * voiced[q : 2 * q]
    out[2 * q : 3 * q] = 0.05 * rng.standard_normal(q)
    return out.astype(np.float32)


def _probs(model, audio: np.ndarray) -> np.ndarray:
    state = np.zeros((2, 1, 128), dtype=np.float32)
    context = np.zeros((1, 64), dtype=np.float32)
    out = []
    for start in range(0, len(audio) - VAD_CHUNK_SAMPLES + 1, VAD_CHUNK_SAMPLES):
        full = np.concatenate([context, audio[start : start + VAD_CHUNK_SAMPLES][None, :]], axis=1)
        prob, state = model.run(full, state)
        context = full[:, -64:]
        out.append(float(prob[0, 0]))
    return np.array(out), state


class NumpySileroTests(unittest.TestCase):
    def test_outputs_are_probabilities_and_state_shape(self):
        probs, state = _probs(_NumpySilero(), _signal())
        self.assertTrue(np.all((probs >= 0) & (probs <= 1)))
        self.assertEqual(state.shape, (2, 1, 128))
        self.assertEqual(state.dtype, np.float32)

    @unittest.skipUnless(_onnxruntime_usable(), "onnxruntime not installed or not importable")
    def test_matches_onnxruntime(self):
        audio = _signal()
        ref, ref_state = _probs(silero_vad._OnnxSilero(), audio)
        got, got_state = _probs(_NumpySilero(), audio)
        # The reference must actually swing, or agreement proves little.
        self.assertGreater(ref.max() - ref.min(), 0.3)
        np.testing.assert_allclose(got, ref, atol=1e-4)
        np.testing.assert_allclose(got_state, ref_state, atol=1e-4)

    def test_weights_match_bundled_onnx(self):
        import hashlib
        recorded = str(np.load(silero_vad._resolve_model_path("silero_vad_16k.npz"))["source_onnx_sha256"])
        actual = hashlib.sha256(silero_vad._resolve_model_path().read_bytes()).hexdigest()
        self.assertEqual(recorded, actual, "re-run scripts/export_silero_weights.py after replacing the ONNX model")


if __name__ == "__main__":
    unittest.main()
