import tempfile
import unittest
import wave
from pathlib import Path

import numpy as np

from src.transcriber import FAST_LEVEL_TARGET_DBFS, _fast_level_normalize


def _write(path, samples, channels=1, rate=16000):
    with wave.open(str(path), 'wb') as w:
        w.setnchannels(channels)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(np.asarray(samples, dtype='<i2').tobytes())


def _read(path):
    with wave.open(str(path), 'rb') as r:
        return np.frombuffer(r.readframes(r.getnframes()), dtype='<i2').astype(np.float32) / 32768.0


class FastLevelNormalizeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.dir = Path(self.tmp.name)

    def test_quiet_sparse_speech_is_lifted_to_target_without_clipping(self):
        rate = 16000
        t = np.arange(rate * 20) / rate
        tone = 0.02 * np.sin(2 * np.pi * 220 * t)  # about -37 dBFS RMS
        tone[rate * 5:rate * 15] = 0                 # long silence, like a quiet mic channel
        tone[rate * 2] = 0.9                          # a single loud click
        _write(self.dir / 'in.wav', np.round(tone * 32767))
        self.assertTrue(_fast_level_normalize(self.dir / 'in.wav', self.dir / 'out.wav'))
        out = _read(self.dir / 'out.wav')
        speech = out[:rate * 2]
        level = 20 * np.log10(np.sqrt(np.mean(speech ** 2)))
        self.assertAlmostEqual(level, FAST_LEVEL_TARGET_DBFS, delta=1.0)
        self.assertLessEqual(np.abs(out).max(), 1.0)
        self.assertEqual(np.abs(out[rate * 6:rate * 14]).max(), 0.0)

    def test_stereo_input_is_left_to_loudnorm(self):
        _write(self.dir / 'in.wav', np.zeros(3200), channels=2)
        self.assertFalse(_fast_level_normalize(self.dir / 'in.wav', self.dir / 'out.wav'))


if __name__ == '__main__':
    unittest.main()
