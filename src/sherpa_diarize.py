"""sherpa-onnx speaker diarization sidecar for Windows and Linux.

Implements the same CLI contract as the macOS Swift/CoreML sidecar
(diarize-sidecar/Sources/main.swift), so src.transcriber and
simple_recorder drive both identically:

  diarize <audio>  -> stdout {"segments":[{"speakerId","start","end"}],
                               "speakers":{"SPEAKER_0":[256 floats]}}
                      stderr PROGRESS:embedding:i/n; exit 3 if models missing
  model-status     -> stdout status JSON; exit 0 ready, 3 not ready
  prepare-models   -> stderr STENO_PROGRESS {...}; stdout status JSON

Models: pyannote segmentation 3.0 + WeSpeaker ResNet34 (256-dim, the same
embedding model pyannote 3.1 uses, so voiceprints keep their dimension).
There is one engine here; STENOAI_DIARIZE_ENGINE is ignored.

The pipeline is pyannote 3.1's, on those two models: segment overlapping
10 s windows into up to three local speakers each, embed every local
speaker, cluster the embeddings into the meeting's speakers, and rebuild one
timeline from the windows. Segmentation runs on onnxruntime, embeddings on
sherpa-onnx (which owns the model's fbank front end).
"""

import hashlib
import json
import os
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

SAMPLE_RATE = 16000
MIN_SEGMENT_S = 0.25
# The segmentation model: 10 s windows, one output frame per 270 samples,
# seven classes over at most three local speakers (none, each one, each pair).
WINDOW_SAMPLES = 160000
FRAME_SAMPLES = 270
WINDOW_FRAMES = 589
LOCAL_SPEAKERS = 3
_POWERSET = ((), (0,), (1,), (2,), (0, 1), (0, 2), (1, 2))
SEGMENTATION_BATCH = 32

# Tuned on eight AMI test meetings (ES2004, IS1009, TS3003, EN2002, a and b;
# frame DER, no collar, overlap scored): average 21.7% against 17.2% for
# perfect clustering of the same segmentation.
# A window every 2.5 s scores ~2 points better than every 5 s.
WINDOW_STEP_FRAMES = 148
# A local speaker is embedded from where it speaks alone, at most this much:
# the embedding costs ~15 ms per second of audio and 5 s scores like 10 s.
MIN_EMBED_S = 0.2
MAX_EMBED_S = 5.0
# Agglomerative clustering with centroid linkage on unit vectors, Euclidean.
# Only embeddings with MIN_CLEAN_S of solo speech vote; the rest are too
# noisy and are assigned to the finished clusters. The threshold is tight on
# purpose: similar voices in one room (IS1009) sit at ~0.68 and a looser one
# merges them into one speaker. Tight clustering leaves fragments, so a
# speaker needs MIN_CLUSTER_SIZE voting embeddings (about 30 s of speech), or
# an eighth of them in a short recording.
CLUSTER_THRESHOLD = 0.6
MIN_CLEAN_S = 2.0
MIN_CLUSTER_SIZE = 12
MIN_CLUSTER_SHARE = 8
MIN_CLUSTER_FLOOR = 3
MAX_CLUSTER_INPUT = 1500

_HF = "https://huggingface.co/csukuangfj"
MODELS = {
    "pyannote-segmentation-3.0.onnx": (
        f"{_HF}/sherpa-onnx-pyannote-segmentation-3-0/resolve/"
        "9403a6902bb58e3d5ae8c7e77c3422de279db2e0/model.onnx",
        "220ad67ca923bef2fa91f2390c786097bf305bceb5e261d4af67b38e938e1079",
    ),
    "wespeaker_en_voxceleb_resnet34_LM.onnx": (
        f"{_HF}/speaker-embedding-models/resolve/"
        "0743f301363dec56491a490f6d6cbc9d67f9a3bf/wespeaker_en_voxceleb_resnet34_LM.onnx",
        "e9848563da86f263117134dfd7ad63c92355b37de492b55e325400c9d9c39012",
    ),
}
SEGMENTATION, EMBEDDING = MODELS


def cache_directory() -> Path:
    override = os.environ.get("STENOAI_DIARIZE_MODEL_DIR")
    if override:
        return Path(override)
    from src.config import get_user_data_dir
    return get_user_data_dir() / "models" / "speaker-diarization" / "sherpa-onnx"


def model_status() -> dict:
    cache = cache_directory()
    missing = [name for name in MODELS if not (cache / name).is_file()]
    return {
        "ready": not missing,
        "cache_directory": str(cache),
        "required_models": list(MODELS),
        "missing_models": missing,
    }


def _progress(percent: int, phase: str) -> None:
    print(f"STENO_PROGRESS {json.dumps({'percent': percent, 'phase': phase})}",
          file=sys.stderr, flush=True)


def prepare_models() -> dict:
    cache = cache_directory()
    cache.mkdir(parents=True, exist_ok=True)
    _progress(0, "listing")
    missing = model_status()["missing_models"]
    for index, name in enumerate(missing):
        url, sha256 = MODELS[name]
        digest = hashlib.sha256()
        with tempfile.NamedTemporaryFile(dir=cache, delete=False) as tmp:
            try:
                with urllib.request.urlopen(url, timeout=60) as response:
                    total = int(response.headers.get("Content-Length") or 0)
                    done = 0
                    for block in iter(lambda: response.read(1 << 20), b""):
                        tmp.write(block)
                        digest.update(block)
                        done += len(block)
                        file_fraction = done / total if total else 0
                        _progress(int(100 * (index + file_fraction) / len(missing)), "downloading")
                tmp.close()
                if digest.hexdigest() != sha256:
                    raise ValueError(f"checksum mismatch for {name}")
                os.replace(tmp.name, cache / name)
            finally:
                if os.path.exists(tmp.name):
                    os.unlink(tmp.name)
    _progress(100, "downloading")
    return model_status()


def _load_audio(path: str):
    import numpy as np
    from src.transcriber import _resolve_ffmpeg

    ffmpeg = _resolve_ffmpeg() or "ffmpeg"
    pcm = subprocess.run(
        [ffmpeg, "-nostdin", "-v", "error", "-i", path,
         "-ac", "1", "-ar", str(SAMPLE_RATE), "-f", "f32le", "-"],
        capture_output=True, check=True,
    ).stdout
    return np.frombuffer(pcm, dtype=np.float32)


# Set by src.transcriber: JSON [[start, end], ...] in seconds, where the
# transcript has speech. Only that audio is diarized (a call's channels are
# silent most of the time); everything else can never receive a label anyway.
REGIONS_ENV = "STENOAI_DIARIZE_REGIONS"


def speech_regions(total_seconds: float) -> list[tuple[float, float]]:
    """The caller's speech regions, clipped to the audio; [] means all of it."""
    try:
        raw = json.loads(os.environ.get(REGIONS_ENV) or "[]")
        regions = sorted((max(0.0, float(a)), min(total_seconds, float(b))) for a, b in raw)
    except (TypeError, ValueError):
        return []
    merged: list[tuple[float, float]] = []
    for start, end in regions:
        if end <= start:
            continue
        if merged and start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((start, end))
    return merged


def restore_times(segments, regions):
    """Map segments timed on the concatenated regions back to source time,
    splitting any that run across a join."""
    restored = []
    offset = 0.0
    for start, end in regions:
        length = end - start
        for seg_start, seg_end, spk in segments:
            left, right = max(seg_start, offset), min(seg_end, offset + length)
            if right > left:
                restored.append((left - offset + start, right - offset + start, spk))
        offset += length
    return sorted(restored)


def centroid(embeddings: list) -> list[float]:
    """L2-normalised mean of per-chunk embeddings (aggregateCentroids)."""
    import numpy as np

    mean = np.mean(np.asarray(embeddings, dtype=np.float64), axis=0)
    norm = np.linalg.norm(mean)
    return (mean / norm if norm > 1e-9 else mean).tolist()


def segment(samples, model_path: str):
    """Local speaker activity per window: (window starts, bool array of
    shape (windows, WINDOW_FRAMES, LOCAL_SPEAKERS))."""
    import numpy as np
    import onnxruntime as ort

    options = ort.SessionOptions()
    options.log_severity_level = 3
    session = ort.InferenceSession(model_path, options, providers=["CPUExecutionProvider"])
    powerset = np.zeros((len(_POWERSET), LOCAL_SPEAKERS), dtype=bool)
    for index, members in enumerate(_POWERSET):
        powerset[index, list(members)] = True

    step = WINDOW_STEP_FRAMES * FRAME_SAMPLES
    starts = np.arange(0, max(1, len(samples) - WINDOW_SAMPLES + step), step)
    activity = np.zeros((len(starts), WINDOW_FRAMES, LOCAL_SPEAKERS), dtype=bool)
    for first in range(0, len(starts), SEGMENTATION_BATCH):
        batch_starts = starts[first:first + SEGMENTATION_BATCH]
        batch = np.zeros((len(batch_starts), 1, WINDOW_SAMPLES), dtype=np.float32)
        for row, start in enumerate(batch_starts):
            window = samples[start:start + WINDOW_SAMPLES]
            batch[row, 0, :len(window)] = window
        logits = session.run(None, {session.get_inputs()[0].name: batch})[0]
        activity[first:first + len(batch_starts)] = powerset[logits.argmax(-1)]
    return starts, activity


def local_speaker_audio(samples, start: int, active, alone):
    """The samples of one window where a local speaker talks -- alone, if
    that leaves enough -- and how many seconds of it are solo speech."""
    import numpy as np

    frame_s = FRAME_SAMPLES / SAMPLE_RATE
    clean = active & alone
    clean_s = float(clean.sum()) * frame_s
    frames = np.flatnonzero(clean if clean_s >= MIN_EMBED_S else active)
    if len(frames) * frame_s < MIN_EMBED_S:
        return None, clean_s
    runs = np.split(frames, np.flatnonzero(np.diff(frames) > 1) + 1)
    audio = np.concatenate([
        samples[start + run[0] * FRAME_SAMPLES:start + (run[-1] + 1) * FRAME_SAMPLES]
        for run in runs
    ])[:int(MAX_EMBED_S * SAMPLE_RATE)]
    return (audio if len(audio) >= MIN_EMBED_S * SAMPLE_RATE else None), clean_s


def centroid_linkage(vectors, threshold: float):
    """Agglomerative clustering of unit vectors: repeatedly merge the two
    clusters whose centroids are closest, until none are within threshold.
    Returns one cluster id per vector."""
    import numpy as np

    count = len(vectors)
    centroids = np.asarray(vectors, dtype=np.float64).copy()
    sizes = np.ones(count)
    alive = np.ones(count, dtype=bool)
    labels = np.arange(count)
    distance = np.linalg.norm(centroids[:, None] - centroids[None], axis=-1)
    np.fill_diagonal(distance, np.inf)
    while alive.sum() > 1:
        keep, drop = np.unravel_index(np.argmin(distance), distance.shape)
        if distance[keep, drop] > threshold:
            break
        centroids[keep] = (
            centroids[keep] * sizes[keep] + centroids[drop] * sizes[drop]
        ) / (sizes[keep] + sizes[drop])
        sizes[keep] += sizes[drop]
        alive[drop] = False
        labels[labels == drop] = keep
        distance[drop, :] = distance[:, drop] = np.inf
        updated = np.linalg.norm(centroids[alive] - centroids[keep], axis=-1)
        distance[keep, alive] = distance[alive, keep] = updated
        distance[keep, keep] = np.inf
    return labels


def cluster(embeddings, clean_seconds, threshold: float = CLUSTER_THRESHOLD):
    """One speaker index per embedding.

    Clusters the embeddings with enough solo speech, keeps the clusters big
    enough to be a speaker, and gives every embedding to its nearest one.
    """
    import numpy as np

    unit = np.asarray(embeddings, dtype=np.float64)
    unit = unit / np.maximum(np.linalg.norm(unit, axis=1, keepdims=True), 1e-9)
    clean_seconds = np.asarray(clean_seconds)
    voting = np.flatnonzero(clean_seconds >= MIN_CLEAN_S)
    if len(voting) == 0:
        voting = np.arange(len(unit))
    if len(voting) > MAX_CLUSTER_INPUT:
        voting = voting[np.argsort(-clean_seconds[voting])[:MAX_CLUSTER_INPUT]]
    labels = centroid_linkage(unit[voting], threshold)
    ids, sizes = np.unique(labels, return_counts=True)
    floor = min(MIN_CLUSTER_SIZE, max(MIN_CLUSTER_FLOOR, len(voting) // MIN_CLUSTER_SHARE))
    kept = ids[sizes >= min(floor, sizes.max())]
    centroids = np.stack([unit[voting][labels == cluster_id].mean(axis=0) for cluster_id in kept])
    centroids /= np.linalg.norm(centroids, axis=1, keepdims=True)
    return (unit @ centroids.T).argmax(axis=1)


def reconstruct(total_samples: int, starts, activity, speaker_of: dict) -> list[tuple[float, float, str]]:
    """One timeline from the overlapping windows.

    ``speaker_of`` maps (window, local speaker) to a meeting speaker. Each
    frame keeps as many speakers as the windows covering it say are talking,
    choosing those most windows agree on (Hamming-weighted, so a window
    counts most where it has context on both sides).
    """
    import numpy as np

    speakers = max(speaker_of.values()) + 1
    frames = int(starts[-1] // FRAME_SAMPLES) + WINDOW_FRAMES
    weight = np.hamming(WINDOW_FRAMES)
    votes = np.zeros((frames, speakers))
    talking = np.zeros(frames)
    covered = np.zeros(frames)
    for window, start in enumerate(starts):
        span = slice(int(start // FRAME_SAMPLES), int(start // FRAME_SAMPLES) + WINDOW_FRAMES)
        covered[span] += weight
        talking[span] += weight * activity[window].sum(axis=-1)
        for local in range(LOCAL_SPEAKERS):
            speaker = speaker_of.get((window, local))
            if speaker is not None:
                votes[span, speaker] += weight * activity[window, :, local]
    count = np.rint(talking / np.maximum(covered, 1e-9)).astype(int)
    ranked = np.argsort(-votes, axis=1)
    active = np.zeros(votes.shape, dtype=bool)
    for rank in range(min(speakers, LOCAL_SPEAKERS)):
        choice = ranked[:, rank]
        chosen = (count > rank) & (votes[np.arange(frames), choice] > 0)
        active[np.flatnonzero(chosen), choice[chosen]] = True

    frame_s = FRAME_SAMPLES / SAMPLE_RATE
    end_s = total_samples / SAMPLE_RATE
    segments = []
    for speaker in range(speakers):
        on = np.flatnonzero(active[:, speaker])
        if not len(on):
            continue
        for run in np.split(on, np.flatnonzero(np.diff(on) > 1) + 1):
            start, end = run[0] * frame_s, min((run[-1] + 1) * frame_s, end_s)
            if end - start >= MIN_SEGMENT_S:
                segments.append((float(start), float(end), f"SPEAKER_{speaker}"))
    return sorted(segments)


def diarize(path: str) -> dict:
    import sherpa_onnx

    cache = cache_directory()
    extractor = sherpa_onnx.SpeakerEmbeddingExtractor(sherpa_onnx.SpeakerEmbeddingExtractorConfig(
        model=str(cache / EMBEDDING), num_threads=max(1, min(6, (os.cpu_count() or 2) // 2)),
    ))

    def embed(audio):
        stream = extractor.create_stream()
        stream.accept_waveform(SAMPLE_RATE, audio)
        stream.input_finished()
        return extractor.compute(stream)

    samples = _load_audio(path)
    regions = speech_regions(len(samples) / SAMPLE_RATE)
    if regions:
        import numpy as np
        samples = np.concatenate(
            [samples[int(a * SAMPLE_RATE):int(b * SAMPLE_RATE)] for a, b in regions]
        )

    starts, activity = segment(samples, str(cache / SEGMENTATION))
    alone = activity.sum(axis=-1) == 1
    keys, embeddings, clean_seconds = [], [], []
    for window, start in enumerate(starts):
        for local in range(LOCAL_SPEAKERS):
            audio, clean_s = local_speaker_audio(
                samples, int(start), activity[window, :, local], alone[window],
            )
            if audio is not None:
                keys.append((window, local))
                embeddings.append(embed(audio))
                clean_seconds.append(clean_s)
        if window % 10 == 0 or window == len(starts) - 1:
            print(f"PROGRESS:embedding:{window + 1}/{len(starts)}", file=sys.stderr, flush=True)
    if not keys:
        return {"segments": [], "speakers": {}}

    threshold = float(os.environ.get("STENOAI_DIARIZE_CLUSTER_THRESHOLD", CLUSTER_THRESHOLD))
    assignment = cluster(embeddings, clean_seconds, threshold)
    segments = reconstruct(
        len(samples), starts, activity, {key: int(spk) for key, spk in zip(keys, assignment)},
    )

    # A speaker's voiceprint is the centroid of its solo-speech embeddings
    # (all of its embeddings if it never speaks alone for long).
    speakers: dict[str, list[float]] = {}
    for speaker in {spk for _, _, spk in segments}:
        index = int(speaker.rsplit("_", 1)[1])
        own = [i for i, spk in enumerate(assignment) if spk == index]
        solo = [i for i in own if clean_seconds[i] >= MIN_CLEAN_S]
        speakers[speaker] = centroid([embeddings[i] for i in solo or own])
    if regions:
        segments = restore_times(segments, regions)

    return {
        "segments": [{"speakerId": spk, "start": s, "end": e} for s, e, spk in segments],
        "speakers": speakers,
    }


def main(argv: list[str]) -> int:
    command = argv[0] if argv else ""
    if command == "model-status":
        status = model_status()
        print(json.dumps(status))
        return 0 if status["ready"] else 3
    if command == "prepare-models":
        try:
            status = prepare_models()
        except Exception as e:  # noqa: BLE001 - reported to the caller as JSON + exit 1
            print(f"steno-diarize: prepare-models failed: {e}", file=sys.stderr)
            return 1
        print(json.dumps(status))
        return 0
    if command == "diarize" and len(argv) == 2:
        status = model_status()
        if not status["ready"]:
            print(json.dumps(status))
            return 3
        try:
            print(json.dumps(diarize(argv[1])))
        except Exception as e:  # noqa: BLE001 - exit 1 is the contract
            print(f"steno-diarize: diarization failed: {e}", file=sys.stderr)
            return 1
        return 0
    print("usage: sherpa_diarize {diarize <audio>|model-status|prepare-models}", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
