import os
import struct
import tempfile
import time
import unittest
import wave
from pathlib import Path
from unittest.mock import patch

from src.cloud_speaker_transcription import plan_windows, tag_speaker_windows, transcribe_speaker_channel
from tests.test_transcriber_openai_asr import _build_transcriber, _FakeOpener, _json_response, _write_signal_wav


class CloudSpeakerTests(unittest.TestCase):
    def test_partitions_every_audio_sample_and_bounds_long_turns(self):
        rate = 16000
        windows = plan_windows([{'start': 5.2, 'end': 150.7, 'speaker': 'A'},
                                {'start': 151.1, 'end': 160, 'speaker': 'B'}], 200 * rate, rate)
        self.assertEqual(windows[0][0], 0)
        self.assertEqual(windows[-1][1], 200 * rate)
        self.assertTrue(all(a[1] == b[0] for a, b in zip(windows, windows[1:])))
        self.assertTrue(all(end > start and end - start <= (60 if speaker else 180) * rate
                            for start, end, speaker in windows))
        self.assertEqual(sum(end - start for start, end, _ in windows), 200 * rate)

    def test_short_pauses_join_a_speakers_turns_and_long_gaps_stay_unowned(self):
        rate = 16000
        windows = plan_windows([
            {'start': 0.0, 'end': 2.0, 'speaker': 'A'},
            {'start': 4.5, 'end': 6.0, 'speaker': 'A'},   # 2.5 s pause: same window
            {'start': 7.0, 'end': 8.0, 'speaker': 'B'},   # 1 s gap: shared at midpoint
            {'start': 9.5, 'end': 10.0, 'speaker': 'A'},  # 1.5 s gap: shared
            {'start': 20.0, 'end': 22.0, 'speaker': 'A'},  # 10 s gap stays unowned
        ], 22 * rate, rate)
        self.assertEqual([(s / rate, e / rate, who) for s, e, who in windows], [
            (0.0, 6.5, 'A'), (6.5, 8.75, 'B'), (8.75, 10.0, 'A'),
            (10.0, 20.0, None), (20.0, 22.0, 'A'),
        ])

    def test_a_different_speaker_between_turns_prevents_joining(self):
        rate = 16000
        windows = plan_windows([
            {'start': 0.0, 'end': 2.0, 'speaker': 'A'},
            {'start': 2.2, 'end': 2.6, 'speaker': 'B'},
            {'start': 3.0, 'end': 5.0, 'speaker': 'A'},
        ], 5 * rate, rate)
        self.assertEqual([who for *_, who in windows], ['A', 'B', 'A'])

    def test_gaps_are_transcribed_not_dropped_and_out_of_order_results_keep_provenance(self):
        calls = []
        class ASR:
            def _run_openai_asr(self, path, language, *, _speaker_gap=False):
                with wave.open(str(path)) as reader:
                    start = struct.unpack('<h', reader.readframes(1))[0] - 1000
                calls.append((start, _speaker_gap, path))
                if start == 0:
                    time.sleep(.05)
                # Native diarization missed speech in the gap: it must survive
                # under an unknown identity, not get attributed to a neighbour.
                return {'text': 'speech outside segmentation' if _speaker_gap and start == 4
                        else None if _speaker_gap else f'turn {start}'}
        # Gaps longer than SHORT_GAP_S stay unowned windows of their own.
        diarization = ([{'start': 1, 'end': 4, 'speaker': 'A'},
                        {'start': 8, 'end': 12, 'speaker': 'B'}], {})
        with tempfile.TemporaryDirectory() as folder:
            audio = Path(folder) / 'audio.wav'
            with wave.open(str(audio), 'wb') as w:
                w.setparams((1, 2, 16000, 0, 'NONE', 'not compressed'))
                for second in range(16):
                    w.writeframes(struct.pack('<h', 1000 + second) * 16000)
            with patch.dict(os.environ, {'STENOAI_OAI_PARALLELISM': '3'}), \
                    patch('src.transcriber._run_steno_diarize', return_value=diarization) as native, \
                    patch('src.cloud_speaker_transcription.report_progress') as progress:
                result = transcribe_speaker_channel(ASR(), audio, audio, 'nl', 'You')
        native.assert_called_once()
        self.assertEqual([s['start'] for s in result['segments']], [0, 4, 8])
        self.assertEqual([s['diarization_speaker_id'] for s in result['segments']], ['A', None, 'B'])
        self.assertIn('speech outside segmentation', result['text'])
        self.assertTrue(all(not path.exists() for _, _, path in calls))
        self.assertEqual(progress.call_args.args, (4, 4))

    def test_failed_native_analysis_preserves_untimed_full_channel_fallback(self):
        with tempfile.TemporaryDirectory() as folder:
            audio = Path(folder) / 'audio.wav'
            _write_signal_wav(audio, 16000)
            from unittest.mock import Mock
            asr = Mock()
            asr._run_openai_asr.return_value = {'text': 'full original text', 'segments': []}
            with patch('src.transcriber._run_steno_diarize', return_value=None):
                result = transcribe_speaker_channel(asr, audio, audio, 'auto', 'You')
            self.assertEqual(result['text'], 'full original text')
            self.assertIs(result['_speaker_diarization'], False)
            asr._run_openai_asr.assert_called_once_with(audio, 'auto')

    def test_known_window_owner_is_preserved_without_second_diarization(self):
        diarization = ([{'start': 0, 'end': 10, 'speaker': 'A'},
                        {'start': 10, 'end': 20, 'speaker': 'B'}], {})
        segments = [{'start': 0, 'text': 'first', 'diarization_speaker_id': 'A'},
                    {'start': 10, 'text': 'second', 'diarization_speaker_id': 'B'},
                    {'start': 21, 'text': 'unsegmented', 'diarization_speaker_id': None}]
        tags = tag_speaker_windows(segments, diarization, 'Others', False, {})
        self.assertEqual([t[3] for t in tags], ['A', 'B', None])
        self.assertEqual(tags[-1][1], 'Others')
        self.assertNotEqual(tags[0][1], tags[1][1])

    def test_current_model_uses_one_json_request_and_plural_language_hint(self):
        asr = _build_transcriber()
        asr._openai_asr_model = 'gpt-transcribe'
        opener = _FakeOpener([_json_response({'text': 'goede middag', 'languages': [{'code': 'nl'}]})])
        with tempfile.TemporaryDirectory() as folder:
            audio = Path(folder) / 'audio.wav'
            _write_signal_wav(audio, 16000)
            with patch.dict(os.environ, {'STENOAI_OAI_API_URL': 'https://api.example/v1',
                                        'STENOAI_OAI_API_ORIGIN': 'https://api.example'}), \
                    patch('urllib.request.build_opener', return_value=opener):
                result = asr._run_openai_asr(audio, 'nl')
        self.assertEqual(len(opener.requests), 1)
        prefix = opener.requests[0]['prefix']
        self.assertIn(b'name="languages[]"', prefix)
        self.assertNotIn(b'name="language"', prefix)
        self.assertIn(b'json', prefix)
        self.assertEqual(result['detected_language'], 'nl')
        self.assertFalse(result['segments'][0]['has_timestamps'])

    def test_predicted_speech_keeps_strict_empty_validation_but_acoustic_gap_allows_consensus(self):
        asr = _build_transcriber()
        asr._openai_asr_model = 'gpt-transcribe'
        with tempfile.TemporaryDirectory() as folder:
            audio = Path(folder) / 'audio.wav'
            _write_signal_wav(audio, 16000)
            for gap in (False, True):
                opener = _FakeOpener([_json_response({'text': ''})])
                with patch.dict(os.environ, {'STENOAI_OAI_API_URL': 'https://api.example/v1',
                                            'STENOAI_OAI_API_ORIGIN': 'https://api.example'}), \
                        patch('urllib.request.build_opener', return_value=opener):
                    if gap:
                        self.assertIsNone(asr._run_openai_asr(audio, 'nl', _speaker_gap=True)['text'])
                    else:
                        with self.assertRaisesRegex(RuntimeError, 'empty transcription'):
                            asr._run_openai_asr(audio, 'nl')

    def test_empty_short_turn_uses_independent_model_without_changing_owner_or_shared_model(self):
        for recovered in (False, True):
            with self.subTest(recovered=recovered), tempfile.TemporaryDirectory() as folder:
                asr = _build_transcriber()
                asr._openai_asr_model = 'gpt-transcribe'
                audio = Path(folder) / 'audio.wav'
                _write_signal_wav(audio, 1600)  # 100 ms, padded only with silence
                second = {'text': 'ja' if recovered else '', 'segments':
                          [{'start': 0, 'end': .1, 'text': 'ja'}] if recovered else []}
                opener = _FakeOpener([_json_response({'text': ''}), _json_response(second)])
                with patch.dict(os.environ, {'STENOAI_OAI_API_URL': 'https://api.example/v1',
                                            'STENOAI_OAI_API_ORIGIN': 'https://api.example',
                                            'STENOAI_OAI_PARALLELISM': '1'}), \
                        patch('urllib.request.build_opener', return_value=opener), \
                        patch('src.transcriber._run_steno_diarize', return_value=(
                            [{'start': 0, 'end': .1, 'speaker': 'A'}], {})):
                    result = transcribe_speaker_channel(asr, audio, audio, 'nl', 'You')
                self.assertEqual(asr._openai_asr_model, 'gpt-transcribe')
                self.assertEqual(len(opener.requests), 2)
                self.assertIn(b'gpt-4o-transcribe-diarize', opener.requests[1]['prefix'])
                if recovered:
                    self.assertEqual(result['text'], 'ja')
                    self.assertEqual(result['segments'][0]['diarization_speaker_id'], 'A')
                    self.assertAlmostEqual(result['segments'][0]['end'], .1)
                else:
                    self.assertEqual(result['segments'], [])

    def test_confirmation_failure_is_not_treated_as_empty_audio(self):
        class ASR:
            _openai_asr_model = 'gpt-transcribe'
            def _run_openai_asr(self, *_args, **_kwargs):
                if self._openai_asr_model == 'gpt-transcribe':
                    raise RuntimeError('openai-asr returned empty transcription for audio with signal')
                raise RuntimeError('confirmation unavailable')
        with tempfile.TemporaryDirectory() as folder:
            audio = Path(folder) / 'audio.wav'
            _write_signal_wav(audio, 16000)
            with patch('src.transcriber._run_steno_diarize', return_value=(
                    [{'start': 0, 'end': 1, 'speaker': 'A'}], {})), \
                    self.assertRaisesRegex(RuntimeError, 'confirmation unavailable'):
                transcribe_speaker_channel(ASR(), audio, audio, 'nl', 'You')

    def test_auto_language_is_seeded_by_substantial_turn_before_short_requests(self):
        calls = []
        class ASR:
            def _run_openai_asr(self, path, language, **_kwargs):
                with wave.open(str(path)) as reader:
                    duration = reader.getnframes() / reader.getframerate()
                calls.append((duration, language))
                return {'text': 'ja' if duration < 8 else 'substantial Dutch speech',
                        'detected_language': 'nl' if language == 'auto' else language}
        with tempfile.TemporaryDirectory() as folder:
            audio = Path(folder) / 'audio.wav'
            _write_signal_wav(audio, 12 * 16000)
            with patch('src.transcriber._run_steno_diarize', return_value=(
                    [{'start': 0, 'end': 2, 'speaker': 'A'},
                     {'start': 2, 'end': 12, 'speaker': 'B'}], {})), \
                    patch.dict(os.environ, {'STENOAI_OAI_PARALLELISM': '3'}):
                result = transcribe_speaker_channel(ASR(), audio, audio, 'auto', 'You')
        self.assertEqual(calls, [(10, 'auto'), (2, 'nl')])
        self.assertEqual(result['detected_language'], 'nl')
        self.assertEqual([s['start'] for s in result['segments']], [0, 2])
        self.assertNotIn('_detected_language', result['segments'][0])
