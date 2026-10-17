"""Bounded ASR work and private, disposable checkpoints for interrupted jobs."""

import contextlib
import contextvars
import hashlib
import json
import logging
import os
import re
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

logger = logging.getLogger(__name__)
_progress = contextvars.ContextVar("openai_asr_progress", default=None)
_slots = {}
_locks = {}
_registry_lock = threading.Lock()
CACHE_MAX_AGE = 7 * 24 * 3600
_pruned_roots = set()


def _prune(root):
    with _registry_lock:
        if str(root) in _pruned_roots:
            return
        _pruned_roots.add(str(root))
    try:
        roots = [root]
        if root.parent.name == 'asr-checkpoints':
            roots = [p for p in root.parent.iterdir()
                     if re.fullmatch(r'[0-9a-f]{64}', p.name) and p.is_dir() and not p.is_symlink()]
        for folder in roots:
            for entry in folder.iterdir():
                if (re.fullmatch(r'chunk-[0-9a-f]{64}\.json|\.checkpoint-[\w-]+', entry.name)
                    and time.time() - entry.stat().st_mtime > CACHE_MAX_AGE):
                    entry.unlink(missing_ok=True)
    except OSError:
        pass


# Upper bound for STENOAI_OAI_PARALLELISM (Settings → AI, default 6 in the app).
MAX_PARALLELISM = 12


def parallelism():
    try:
        return max(1, min(MAX_PARALLELISM, int(os.environ.get("STENOAI_OAI_PARALLELISM", "1"))))
    except ValueError:
        return 1


def chunk_seconds(default):
    try:
        return max(1, min(default, int(os.environ.get("STENOAI_OAI_CHUNK_SECONDS", str(default)))))
    except ValueError:
        return default


@contextlib.contextmanager
def request_slot():
    limit = parallelism()
    with _registry_lock:
        slots = _slots.setdefault(limit, threading.BoundedSemaphore(limit))
    with slots:
        yield


@contextlib.contextmanager
def progress_scope(callback):
    token = _progress.set(callback)
    try:
        yield
    finally:
        _progress.reset(token)


def report_progress(done, total):
    callback = _progress.get()
    if callback:
        callback(done, total)
    else:
        print(f"PROGRESS:transcribe:{done}/{total}", flush=True)


def indexed_jobs(count, worker):
    """Run bounded work; yield indexed results as completed, never reorder text."""
    if parallelism() == 1:
        for index in range(count):
            yield index, worker(index)
        return
    pool = ThreadPoolExecutor(max_workers=min(parallelism(), count))
    futures = {pool.submit(worker, index): index for index in range(count)}
    try:
        for future in as_completed(futures):
            yield futures[future], future.result()
    finally:
        # Pending requests never start after a failure. Running requests finish
        # under their own finite deadlines and retain successful checkpoints.
        for future in futures:
            future.cancel()
        pool.shutdown(wait=True, cancel_futures=True)


def _json_bytes(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()


class Checkpoints:
    def __init__(self, identity):
        root = os.environ.get("STENOAI_OAI_CACHE_DIR")
        self.root = Path(root) if root else None
        self.identity = _json_bytes({"schema": 1, **identity})
        if self.root:
            _prune(self.root)

    def run(self, audio_path, job, validate):
        if self.root is None:
            return job()
        digest = hashlib.sha256(self.identity)
        with open(audio_path, "rb") as audio:
            for block in iter(lambda: audio.read(1024 * 1024), b""):
                digest.update(block)
        key = digest.hexdigest()
        target = self.root / f"chunk-{key}.json"
        with _registry_lock:
            lock = _locks.setdefault(str(target), threading.Lock())
        with lock:
            try:
                if target.stat().st_size <= 16 * 1024 * 1024:
                    record = json.loads(target.read_text())
                    result = record["result"]
                    if (record["key"] == key and 0 <= time.time() - record["saved_at"] < CACHE_MAX_AGE
                        and record["checksum"] == hashlib.sha256(_json_bytes(result)).hexdigest()
                        and isinstance(result, dict)
                        and isinstance(result.get("segments"), list)):
                        result = validate(result)
                        logger.info("openai-asr: resumed completed chunk from local checkpoint")
                        return result
            except (OSError, ValueError, KeyError, TypeError, RuntimeError, AttributeError):
                pass
            result = job()
            temporary = None
            try:
                self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
                record = {"key": key, "saved_at": time.time(), "result": result,
                          "checksum": hashlib.sha256(_json_bytes(result)).hexdigest()}
                fd, temporary = tempfile.mkstemp(prefix=".checkpoint-", dir=self.root)
                with os.fdopen(fd, "wb") as output:
                    output.write(_json_bytes(record))
                    output.flush()
                    os.fsync(output.fileno())
                os.replace(temporary, target)
            except (OSError, ValueError, TypeError):
                logger.warning("openai-asr: checkpoint unavailable; keeping successful result in memory")
            finally:
                if temporary:
                    try:
                        Path(temporary).unlink(missing_ok=True)
                    except OSError:
                        pass
            return result


def clear_checkpoints():
    """Only discard our records, after a successful atomic final note save."""
    root = os.environ.get("STENOAI_OAI_CACHE_DIR")
    if not root:
        return
    try:
        for entry in Path(root).iterdir():
            if re.fullmatch(r"chunk-[0-9a-f]{64}\.json", entry.name):
                entry.unlink(missing_ok=True)
    except OSError:
        logger.warning("openai-asr: could not clear completed job checkpoints")
