"""Opt-in local benchmark runner. No meeting, profile, vault or preference writes."""
import json
import os
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path


MODELS = {'whisper-1', 'gpt-transcribe', 'gpt-4o-transcribe-diarize', 'gpt-4o-mini-transcribe', 'gpt-4o-transcribe'}


def run_job(job_file):
    job = json.loads(Path(job_file).read_text())
    engine = job['engine']
    if engine not in {'whisper', 'parakeet', 'openai-asr'}:
        raise ValueError('Unsupported benchmark engine')
    model = job.get('model', 'large-v3-turbo')
    if engine == 'openai-asr' and model not in MODELS:
        raise ValueError('Unsupported benchmark model')
    root = Path(os.environ['STENOAI_USER_DATA_DIR'])
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    config = {'transcription_engine': engine, 'whisper_model': 'large-v3-turbo',
              'openai_asr_model': model,
              'openai_asr_api_url': os.environ.get('STENOAI_OAI_API_URL', 'https://api.openai.com/v1')}
    root.joinpath('config.json').write_text(json.dumps(config))
    from src.transcriber import WhisperTranscriber
    started = time.monotonic()
    transcriber = WhisperTranscriber(model_size='large-v3-turbo')
    load_seconds = time.monotonic() - started
    if engine == 'openai-asr' and transcriber.backend != 'openai-asr':
        raise RuntimeError('Benchmark engine mismatch')
    if engine == 'whisper' and transcriber.backend != 'whisper.cpp':
        raise RuntimeError('Benchmark engine mismatch')
    if engine == 'parakeet' and transcriber.backend != 'parakeet-tdt-v3':
        raise RuntimeError('Benchmark engine mismatch')
    output = {'engine': engine, 'model': model, 'backend': transcriber.backend,
              'language': job.get('language', 'auto'), 'load_seconds': load_seconds, 'passes': []}
    destination = Path(job['output'])
    destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    for iteration in range(min(2, max(1, int(job.get('passes', 2))))):
        start = time.monotonic()
        if job.get('full_pipeline'):
            result = transcriber.transcribe_diarised(Path(job['audio']), output['language'])
            if result.get('transcription_failed'):
                raise RuntimeError('Benchmark transcription failed')
            results = [result]
        else:
            paths = [Path(p) for p in job['inputs']]
            if engine == 'openai-asr':
                with ThreadPoolExecutor(max_workers=2) as pool:
                    results = list(pool.map(lambda p: transcriber._run_backend(p, output['language']), paths))
            else:
                results = [transcriber._run_backend(p, output['language']) for p in paths]
        record = {'iteration': iteration + 1, 'seconds': time.monotonic() - start,
                  'results': results}
        output['passes'].append(record)
        fd = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, 'w') as stream:
            json.dump(output, stream, ensure_ascii=False, indent=2)
        print(f"BENCHMARK:pass={iteration + 1} seconds={record['seconds']:.3f}", flush=True)
    return output


if __name__ == '__main__':
    import sys
    run_job(sys.argv[1])
