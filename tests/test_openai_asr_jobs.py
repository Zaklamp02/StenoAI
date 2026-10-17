"""Concurrency, ordering and durable recovery; never calls a cloud provider."""
import io
import json
import os
import subprocess
import sys
import tempfile
import threading
import unittest
import wave
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

from src.openai_asr_jobs import Checkpoints, clear_checkpoints, indexed_jobs, request_slot


def write_parts(path):
    with wave.open(str(path), 'wb') as audio:
        audio.setparams((1, 2, 16000, 0, 'NONE', 'not compressed'))
        for index in range(1, 5):
            audio.writeframes(index.to_bytes(2, 'little', signed=True) * 16000)


class OpenAiJobTests(unittest.TestCase):
    def test_shared_request_limit_applies_across_two_channel_pools(self):
        lock = threading.Lock()
        active = 0
        peak = 0
        two_active = threading.Event()
        release = threading.Event()

        def work(index):
            nonlocal active, peak
            with request_slot():
                with lock:
                    active += 1
                    peak = max(peak, active)
                    if active == 2:
                        two_active.set()
                if not release.wait(5):
                    raise AssertionError('test failed to release requests')
                with lock:
                    active -= 1
                return index

        with patch.dict(os.environ, {'STENOAI_OAI_PARALLELISM': '2'}):
            with ThreadPoolExecutor(max_workers=2) as channels:
                jobs = [channels.submit(lambda: list(indexed_jobs(4, work))) for _ in range(2)]
                try:
                    self.assertTrue(two_active.wait(3))
                finally:
                    release.set()
                for job in jobs:
                    self.assertEqual(sorted(job.result()), [(i, i) for i in range(4)])
        self.assertEqual(peak, 2)

    def test_cached_result_is_invalidated_by_audio_model_language_and_corruption(self):
        with tempfile.TemporaryDirectory() as tmp, patch.dict(os.environ, {'STENOAI_OAI_CACHE_DIR': tmp}):
            audio = Path(tmp) / 'audio.wav'
            audio.write_bytes(b'audio-one')
            count = 0

            def request():
                nonlocal count
                count += 1
                return {'text': 'synthetic', 'segments': []}

            def run(model='one', language='en'):
                return Checkpoints({'endpoint': 'https://api.example/v1/audio/transcriptions',
                                    'model': model, 'language': language}).run(audio, request, lambda x: x)

            run()
            run()
            self.assertEqual(count, 1)
            run(model='two')
            run(language='nl')
            self.assertEqual(count, 3)
            audio.write_bytes(b'audio-two')
            run()
            self.assertEqual(count, 4)
            for entry in Path(tmp).glob('chunk-*.json'):
                entry.write_text('{broken')
            run()
            self.assertEqual(count, 5)
            sentinel = Path(tmp) / 'unrelated.txt'
            sentinel.write_text('keep')
            clear_checkpoints()
            self.assertEqual(list(Path(tmp).glob('chunk-*.json')), [])
            self.assertTrue(sentinel.exists())

    def test_checkpoint_write_failure_does_not_lose_successful_transcription(self):
        with tempfile.TemporaryDirectory() as tmp, patch.dict(os.environ, {'STENOAI_OAI_CACHE_DIR': tmp}):
            audio = Path(tmp) / 'audio.wav'
            audio.write_bytes(b'audio')
            with patch('src.openai_asr_jobs.os.replace', side_effect=OSError('disk full')):
                result = Checkpoints({'model': 'test'}).run(audio,
                    lambda: {'text': 'keep this', 'segments': []}, lambda x: x)
            self.assertEqual(result['text'], 'keep this')
            self.assertEqual(list(Path(tmp).glob('.checkpoint-*')), [])

    def test_real_process_interruption_resumes_only_missing_parts_in_timeline_order(self):
        counts = Counter()
        lock = threading.Lock()
        blocked = threading.Event()
        release = threading.Event()

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_POST(self):
                payload = self.rfile.read(int(self.headers['Content-Length']))
                start = payload.index(b'RIFF')
                with wave.open(io.BytesIO(payload[start:]), 'rb') as audio:
                    index = int.from_bytes(audio.readframes(1), 'little', signed=True)
                with lock:
                    counts[index] += 1
                    occurrence = counts[index]
                if index == 3 and occurrence == 1:
                    blocked.set()
                    release.wait(10)
                # Force completion out of order after restart: part four frees three.
                if index == 3 and occurrence > 1:
                    fourth_done.wait(5)
                body = json.dumps({'text': f'part{index}', 'segments': [
                    {'text': f'part{index}', 'start': 0.1, 'end': 0.2}], 'duration': 1}).encode()
                try:
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json')
                    self.send_header('Content-Length', str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
                except (BrokenPipeError, ConnectionResetError):
                    pass
                if index == 4:
                    fourth_done.set()

        fourth_done = threading.Event()
        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        script = '''
import json, sys
from pathlib import Path
import src.transcriber as module
module.OPENAI_ASR_CHUNK_OVERLAP_SECONDS = 0
transcriber = module.WhisperTranscriber.__new__(module.WhisperTranscriber)
transcriber._openai_asr_api_key = 'synthetic-key'
transcriber._openai_asr_model = 'whisper-1'
result = transcriber._run_openai_asr(Path(sys.argv[1]), 'en')
Path(sys.argv[2]).write_text(json.dumps(result))
'''
        try:
            with tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                audio, result_file = root / 'audio.wav', root / 'result.json'
                write_parts(audio)
                endpoint = f'http://127.0.0.1:{server.server_port}'
                env = {**os.environ, 'STENOAI_USER_DATA_DIR': str(root / 'user-data'),
                       'STENOAI_OAI_API_ORIGIN': endpoint, 'STENOAI_OAI_API_URL': endpoint + '/v1',
                       'STENOAI_OAI_CACHE_DIR': str(root / 'checkpoints'),
                       'STENOAI_OAI_PARALLELISM': '1', 'STENOAI_OAI_CHUNK_SECONDS': '1'}
                first = subprocess.Popen([sys.executable, '-c', script, str(audio), str(result_file)],
                    env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                try:
                    self.assertTrue(blocked.wait(10), 'first process did not reach part three')
                    self.assertEqual(len(list((root / 'checkpoints').glob('chunk-*.json'))), 2)
                finally:
                    first.terminate()
                    first.wait(timeout=5)
                    release.set()
                self.assertFalse(result_file.exists())
                env['STENOAI_OAI_PARALLELISM'] = '2'
                second = subprocess.run([sys.executable, '-c', script, str(audio), str(result_file)],
                    env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=15)
                self.assertEqual(second.returncode, 0, second.stderr.decode())
                result = json.loads(result_file.read_text())
                self.assertEqual(result['text'], 'part1 part2 part3 part4')
                self.assertEqual([x['start'] for x in result['segments']], [0.1, 1.1, 2.1, 3.1])
                self.assertEqual(counts, {1: 1, 2: 1, 3: 2, 4: 1})
        finally:
            release.set()
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)
