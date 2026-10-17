'use strict';

const fsDefault = require('fs');
const osDefault = require('os');
const pathDefault = require('path');

// Warm the speaker models while a recording runs. The first steno-diarize run
// after a while spends ~1.5 min compiling its CoreML models before any audio
// is analysed, which otherwise lands on the meeting's processing time. A run
// on one second of silence loads both models (Sortformer and the voiceprint
// model) and leaves the compiled programs in the system's CoreML cache for the
// real job.
//
// This is the one steno-diarize spawn outside Python: it analyses no user
// audio, only a generated silent clip, and returns nothing to the pipeline.
// Rules it keeps:
// - never two acoustic models at once: it does not start while a processing
//   job, re-transcription or live transcription runs, and jobs call idle()
//   to wait for a running warm-up before they start;
// - never slow capture: it starts after the pre-flight check window and runs
//   at a lowered CPU priority;
// - best-effort: every failure is logged and ignored.

const WARMUP_DELAY_MS = 25_000;      // after the 20 s pre-flight capture check
const WARMUP_TIMEOUT_MS = 180_000;   // first CoreML compile measured ~97 s
const WARM_FOR_MS = 60 * 60 * 1000;  // a warm-up within the hour is reused
const LOW_PRIORITY = 10;             // nice value; capture runs in the renderer

/** 16 kHz mono 16-bit PCM WAV of `seconds` digital silence. */
function silentWav(seconds = 1, sampleRate = 16000) {
  const dataBytes = Math.round(seconds * sampleRate) * 2;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);              // PCM
  buf.writeUInt16LE(1, 22);              // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buf.writeUInt16LE(2, 32);              // block align
  buf.writeUInt16LE(16, 34);             // bits per sample
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataBytes, 40);
  return buf;
}

/** The sidecar next to the bundled backend, as src.transcriber resolves it. */
function resolveSidecar({ backendPath, repoRoot, fs = fsDefault, path = pathDefault }) {
  const dir = path.dirname(backendPath);
  const candidates = [path.join(dir, 'steno-diarize'), path.join(dir, '_internal', 'steno-diarize')];
  if (repoRoot) candidates.push(path.join(repoRoot, 'bin', 'steno-diarize'));
  for (const candidate of candidates) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch { /* next */ }
  }
  return null;
}

function createSpeakerModelWarmup({
  spawn,
  platform = process.platform,
  resolveBinary,
  getEnv,
  isBusy,
  onLog = () => {},
  setPriority = (pid, value) => osDefault.setPriority(pid, value),
  fs = fsDefault,
  tmpdir = () => osDefault.tmpdir(),
  path = pathDefault,
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  delayMs = WARMUP_DELAY_MS,
  timeoutMs = WARMUP_TIMEOUT_MS,
  warmForMs = WARM_FOR_MS,
}) {
  let scheduled = null;
  let running = null;       // { proc, done: Promise<void> }
  let lastAttemptAtMs = null;

  function log(message) {
    try { onLog(`[speaker-warmup] ${message}`); } catch { /* logging only */ }
  }

  function skipReason() {
    if (platform !== 'darwin') return 'not macOS';
    if (running) return 'already running';
    if (lastAttemptAtMs !== null && now() - lastAttemptAtMs < warmForMs) return 'warmed recently';
    const busy = isBusy();
    if (busy) return busy;
    return null;
  }

  function run() {
    scheduled = null;
    const reason = skipReason();
    if (reason) {
      log(`skipped (${reason})`);
      return false;
    }
    const binary = resolveBinary();
    if (!binary) {
      log('skipped (steno-diarize not bundled)');
      lastAttemptAtMs = now();
      return false;
    }
    const clip = path.join(tmpdir(), `stenoai-speaker-warmup-${process.pid}.wav`);
    try {
      fs.writeFileSync(clip, silentWav(), { mode: 0o600 });
    } catch (e) {
      log(`skipped (could not write clip: ${e.message})`);
      return false;
    }
    lastAttemptAtMs = now();
    const startedAt = now();
    let proc;
    try {
      proc = spawn(binary, ['diarize', clip], { env: getEnv(), stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (e) {
      log(`spawn failed: ${e.message}`);
      try { fs.unlinkSync(clip); } catch { /* */ }
      return false;
    }
    try { if (proc.pid) setPriority(proc.pid, LOW_PRIORITY); } catch { /* best effort */ }
    let stderrTail = '';
    proc.stderr?.on('data', (chunk) => { stderrTail = (stderrTail + chunk).slice(-300); });
    const done = new Promise((resolve) => {
      const timer = setTimer(() => {
        log(`timed out after ${Math.round(timeoutMs / 1000)}s; stopping it`);
        try { proc.kill('SIGKILL'); } catch { /* */ }
      }, timeoutMs);
      const finish = (code, error) => {
        clearTimer(timer);
        try { fs.unlinkSync(clip); } catch { /* */ }
        const seconds = ((now() - startedAt) / 1000).toFixed(1);
        if (error) log(`failed after ${seconds}s: ${error.message}`);
        else if (code === 0) log(`speaker models warm after ${seconds}s`);
        else if (code === 3) log('speaker models are not prepared; nothing to warm');
        else log(`exited ${code} after ${seconds}s${stderrTail ? `: ${stderrTail.trim()}` : ''}`);
        if (running && running.proc === proc) running = null;
        resolve();
      };
      proc.once('error', (error) => finish(null, error));
      proc.once('exit', (code) => finish(code, null));
    });
    running = { proc, done };
    log('warming speaker models');
    return true;
  }

  return {
    /** Called when a recording starts: warm after the pre-flight window. */
    schedule() {
      if (scheduled || running) return;
      if (platform !== 'darwin') return;
      scheduled = setTimer(run, delayMs);
    },
    /** Called when the recording stops before the warm-up began. */
    cancelScheduled() {
      if (!scheduled) return;
      clearTimer(scheduled);
      scheduled = null;
    },
    /** Resolves once no warm-up runs, so a job never loads models alongside it. */
    idle() {
      return running ? running.done : Promise.resolve();
    },
    isRunning: () => running !== null,
    /** For tests: run now, bypassing the delay. */
    runNow: run,
  };
}

module.exports = {
  createSpeakerModelWarmup, resolveSidecar, silentWav,
  WARMUP_DELAY_MS, WARMUP_TIMEOUT_MS, WARM_FOR_MS,
};
