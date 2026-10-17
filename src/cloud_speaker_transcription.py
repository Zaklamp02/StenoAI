"""Cloud text transcription tied to local acoustic turns, never invented word times."""
from __future__ import annotations

import os
import copy
import logging
import tempfile
import threading
import wave
from pathlib import Path

from src.openai_asr_jobs import indexed_jobs, progress_scope, report_progress

_DIARIZATION_LOCK = threading.Lock()
logger = logging.getLogger(__name__)


def plan_windows(segments, frames, rate):
    """Partition every sample, including uncovered gaps; split long speaker turns."""
    duration = frames / rate
    spans = []
    for segment in segments:
        start = max(0.0, min(duration, float(segment['start'])))
        end = max(start, min(duration, float(segment['end'])))
        if end > start:
            spans.append([start, end, segment['speaker']])
    for i in range(len(spans) - 1):
        gap = spans[i + 1][0] - spans[i][1]
        if 0 <= gap <= 1.0:
            midpoint = (spans[i + 1][0] + spans[i][1]) / 2
            spans[i][1] = spans[i + 1][0] = midpoint
    if spans and spans[0][0] <= 1.0:
        spans[0][0] = 0.0
    if spans and duration - spans[-1][1] <= 1.0:
        spans[-1][1] = duration
    partitions = []
    cursor = 0
    for start, end, speaker in spans:
        left = max(cursor, round(start * rate))
        right = max(left, round(end * rate))
        if left > cursor:
            partitions.append((cursor, left, None))
        if right > left:
            partitions.append((left, right, speaker))
        cursor = right
    if cursor < frames:
        partitions.append((cursor, frames, None))
    windows = []
    for start, end, speaker in partitions:
        limit = rate * (60 if speaker is not None else 180)
        for left in range(start, end, limit):
            windows.append((left, min(end, left + limit), speaker))
    return windows


def transcribe_speaker_channel(transcriber, prepared, original, language, label):
    from src.transcriber import (
        STENO_DIARIZE_TIMEOUT_FLOOR_S, _heartbeat_while_waiting,
        _openai_asr_analyse_canonical_wav, _run_steno_diarize,
    )
    with wave.open(str(prepared), 'rb') as reader:
        params = reader.getparams()
        if params.nchannels != 1 or params.sampwidth != 2 or params.comptype != 'NONE':
            raise RuntimeError('Speaker transcription requires canonical mono PCM')
        duration = params.nframes / params.framerate
    # CoreML helpers are serialized: cloud request workers may overlap the next
    # channel's analysis, but two full acoustic models never load concurrently.
    with _heartbeat_while_waiting('diarize:waiting'):
        with _DIARIZATION_LOCK:
            print(f'PROGRESS:diarize:{label}:start', flush=True)
            try:
                diarization = _run_steno_diarize(
                    original, max(STENO_DIARIZE_TIMEOUT_FLOOR_S, int(duration)),
                    progress_sink=lambda i, n: print(f'PROGRESS:diarize:{label}:embedding:{i}/{n}', flush=True),
                )
            finally:
                print(f'PROGRESS:diarize:{label}:done', flush=True)
    if diarization is None:
        # Preserve all speech without pretending that failed analysis identified
        # anyone. The existing channel-only fallback remains available.
        result = transcriber._run_openai_asr(prepared, language)
        result['_speaker_diarization'] = False
        return result
    windows = plan_windows(diarization[0], params.nframes, params.framerate)
    results = [None] * len(windows)
    report_progress(0, len(windows))
    language_hint = language

    def run(index):
        start, end, speaker = windows[index]
        fd, filename = tempfile.mkstemp(prefix='stenoai_turn_', suffix='.wav')
        os.close(fd)
        path = Path(filename)
        try:
            with wave.open(str(prepared), 'rb') as source, wave.open(str(path), 'wb') as output:
                source.setpos(start)
                output.setparams(params)
                data = source.readframes(end - start)
                if len(data) != (end - start) * 2:
                    raise RuntimeError('Speaker transcription audio window was truncated')
                output.writeframes(data)
                # Very short acoustic turns can be backchannels or clicks.
                # Add silence, never neighbouring speech, for API minimum input
                # length; their displayed bounds remain the original audio turn.
                padding = max(0, params.framerate - (end - start))
                if padding:
                    output.writeframes(b'\0\0' * padding)
            analysis = _openai_asr_analyse_canonical_wav(path)
            if speaker is None and analysis and not analysis[1]:
                result = {'text': None}
            else:
                # Only a gap classified as non-speech by the acoustic model may
                # accept empty text. Predicted speech retains strict validation.
                with progress_scope(lambda _done, _total: None):
                    try:
                        result = transcriber._run_openai_asr(path, language_hint, _speaker_gap=speaker is None)
                    except RuntimeError as error:
                        if str(error) != 'openai-asr returned empty transcription for audio with signal':
                            raise
                        # Acoustic diarization also detects some nonlexical
                        # sounds. Do not fail a long meeting over one cough, or
                        # silently discard possible words after one empty ASR.
                        # Check the exact same turn with an independent model.
                        # Never change the shared transcriber used by workers.
                        logger.warning('openai-asr: empty speaker turn at %.2fs (%.2fs); checking independent model',
                                       start / params.framerate, (end - start) / params.framerate)
                        confirmation = copy.copy(transcriber)
                        confirmation._openai_asr_model = 'gpt-4o-transcribe-diarize'
                        result = confirmation._run_openai_asr(path, language_hint, _confirm_empty_turn=True)
                        logger.info('openai-asr: independent turn check at %.2fs: %s',
                                    start / params.framerate,
                                    'speech recovered' if result.get('text') else 'both models empty')
            text = (result.get('text') or '').strip()
            if not text:
                return None
            return {'text': text, 'start': start / params.framerate,
                    'end': end / params.framerate, 'has_timestamps': True,
                    'timing_source': 'audio_turn', 'speaker_window': True,
                    'diarization_speaker_id': speaker,
                    '_detected_language': result.get('detected_language')}
        finally:
            path.unlink(missing_ok=True)

    completed = 0
    remaining = list(range(len(windows)))
    if language == 'auto':
        # An isolated "ja" or half-word has too little context for reliable
        # language detection. Reuse one substantial speech turn as a language
        # hint for this channel; it is one of the normal requests, not a second
        # upload. Explicit user language choices still take precedence.
        seed = next((i for i, (start, end, speaker) in enumerate(windows)
                     if speaker is not None and end - start >= 8 * params.framerate), None)
        if seed is not None:
            results[seed] = run(seed)
            detected = (results[seed] or {}).get('_detected_language')
            if detected:
                language_hint = detected
                logger.info('openai-asr: language hint from substantive %s turn: %s', label, detected)
            remaining.remove(seed)
            completed = 1
            report_progress(completed, len(windows))
    pending_results = indexed_jobs(len(remaining), lambda i: run(remaining[i])) if remaining else ()
    for position, segment in pending_results:
        results[remaining[position]] = segment
        completed += 1
        report_progress(completed, len(windows))
    # indexed_jobs completes out of order; retain input order and exact offsets.
    segments = [value for value in results if value is not None]
    for segment in segments:
        segment.pop('_detected_language', None)
    return {'text': '\n'.join(s['text'] for s in segments) or None,
            'segments': segments, 'duration_seconds': duration,
            'detected_language': None if language_hint == 'auto' else language_hint,
            'detected_language_probability': None, 'window_coverage': 1.0,
            '_speaker_diarization': diarization}


def tag_speaker_windows(segments, diarization, legacy_label, allow_self_match, clusters_out):
    from src.transcriber import _apply_voiceprint_matches, _cluster_channel_label_plan
    from src.speaker_suggestions import build_clusters_from_diarization
    if not diarization:
        return [(s['start'], legacy_label, s['text'], None) for s in segments]
    acoustic_segments, embeddings = diarization
    labels, eligible = _cluster_channel_label_plan(acoustic_segments, legacy_label)
    if labels:
        labels = _apply_voiceprint_matches(embeddings, labels, legacy_label, allow_self_match, eligible)
    else:
        labels = {s['speaker']: legacy_label for s in acoustic_segments}
    if clusters_out is not None and embeddings:
        clusters_out.update(build_clusters_from_diarization(acoustic_segments, embeddings))
    return [(s['start'], labels.get(s.get('diarization_speaker_id'), legacy_label),
             s['text'], s.get('diarization_speaker_id')) for s in segments]
