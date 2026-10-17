import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from src.asr_benchmark import run_job


class BenchmarkTests(unittest.TestCase):
    def test_isolates_config_and_saves_both_passes_without_credentials(self):
        class Transcriber:
            backend = 'openai-asr'

            def __init__(self, **kwargs):
                pass

            def _run_backend(self, audio, language):
                return {'text': 'synthetic', 'segments': [{'start': 0, 'end': 1, 'text': 'synthetic'}]}

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            job = root / 'test-job.json'
            destination = root / 'results.json'
            job.write_text(json.dumps({'engine': 'openai-asr', 'model': 'whisper-1',
                'inputs': ['one.wav', 'two.wav'], 'output': str(destination), 'passes': 2}))
            with patch.dict(os.environ, {'STENOAI_USER_DATA_DIR': str(root / 'isolated'),
                'STENOAI_OAI_API_KEY': 'secret-test-token'}), patch('src.transcriber.WhisperTranscriber', Transcriber):
                result = run_job(job)
            self.assertEqual(len(result['passes']), 2)
            self.assertEqual(len(result['passes'][0]['results']), 2)
            self.assertEqual(destination.stat().st_mode & 0o777, 0o600)
            self.assertNotIn('secret-test-token', destination.read_text())
            config = root / 'isolated/config.json'
            self.assertEqual(json.loads(config.read_text())['openai_asr_model'], 'whisper-1')
            self.assertNotIn('secret-test-token', config.read_text())

    def test_unknown_models_fail_before_any_transcription(self):
        with tempfile.TemporaryDirectory() as temporary:
            job = Path(temporary) / 'test-job.json'
            job.write_text(json.dumps({'engine': 'openai-asr', 'model': 'unrecognised'}))
            with self.assertRaises(ValueError):
                run_job(job)
