'use strict';

const test = require('node:test');
const assert = require('node:assert');
const EventEmitter = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createSpeakerModelWarmup, resolveSidecar, silentWav } = require('./speaker-model-warmup');

function fakeProc() {
  const proc = new EventEmitter();
  proc.pid = 4242;
  proc.stderr = new EventEmitter();
  proc.killed = null;
  proc.kill = (signal) => { proc.killed = signal; };
  return proc;
}

function harness(overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'steno-warmup-'));
  const spawned = [];
  const timers = [];
  const priorities = [];
  const logs = [];
  let clock = 1_000_000;
  const warmup = createSpeakerModelWarmup({
    platform: 'darwin',
    spawn: (binary, args, options) => {
      const proc = fakeProc();
      spawned.push({ binary, args, options, proc });
      return proc;
    },
    resolveBinary: () => '/bundle/steno-diarize',
    getEnv: () => ({ PATH: '/usr/bin' }),
    isBusy: () => null,
    onLog: (m) => logs.push(m),
    setPriority: (pid, value) => priorities.push([pid, value]),
    tmpdir: () => dir,
    now: () => clock,
    setTimer: (fn, ms) => { const t = { fn, ms, cleared: false }; timers.push(t); return t; },
    clearTimer: (t) => { if (t) t.cleared = true; },
    ...overrides,
  });
  return { warmup, spawned, timers, priorities, logs, dir, tick: (ms) => { clock += ms; } };
}

test('schedules after the pre-flight window, then runs the sidecar on a silent clip at low priority', async () => {
  const h = harness();
  h.warmup.schedule();
  assert.strictEqual(h.spawned.length, 0);
  assert.strictEqual(h.timers[0].ms, 25_000);
  h.timers[0].fn();
  assert.strictEqual(h.spawned.length, 1);
  const { binary, args, options, proc } = h.spawned[0];
  assert.strictEqual(binary, '/bundle/steno-diarize');
  assert.strictEqual(args[0], 'diarize');
  assert.ok(args[1].startsWith(h.dir));
  assert.ok(fs.readFileSync(args[1]).subarray(0, 4).equals(Buffer.from('RIFF')));
  assert.deepStrictEqual(options.env, { PATH: '/usr/bin' });
  assert.deepStrictEqual(h.priorities, [[4242, 10]]);
  assert.ok(h.warmup.isRunning());

  let idle = false;
  const waiting = h.warmup.idle().then(() => { idle = true; });
  await Promise.resolve();
  assert.strictEqual(idle, false, 'a job waits while the warm-up holds the models');
  proc.emit('exit', 0);
  await waiting;
  assert.strictEqual(h.warmup.isRunning(), false);
  assert.ok(!fs.existsSync(args[1]), 'the clip is removed');
  assert.ok(h.logs.some((m) => m.includes('speaker models warm')));
});

test('never starts while another model job is running', () => {
  const h = harness({ isBusy: () => 'a meeting is processing' });
  assert.strictEqual(h.warmup.runNow(), false);
  assert.strictEqual(h.spawned.length, 0);
  assert.ok(h.logs.some((m) => m.includes('a meeting is processing')));
});

test('a warm-up within the hour is not repeated', () => {
  const h = harness();
  assert.strictEqual(h.warmup.runNow(), true);
  h.spawned[0].proc.emit('exit', 0);
  h.tick(10 * 60 * 1000);
  assert.strictEqual(h.warmup.runNow(), false);
  h.tick(51 * 60 * 1000);
  assert.strictEqual(h.warmup.runNow(), true);
});

test('a stop before the delay cancels the scheduled warm-up', () => {
  const h = harness();
  h.warmup.schedule();
  h.warmup.cancelScheduled();
  assert.strictEqual(h.timers[0].cleared, true);
  assert.strictEqual(h.spawned.length, 0);
});

test('a hung warm-up is killed at its timeout and still releases waiting jobs', async () => {
  const h = harness();
  h.warmup.runNow();
  const timeout = h.timers.find((t) => t.ms === 180_000);
  assert.ok(timeout);
  timeout.fn();
  assert.strictEqual(h.spawned[0].proc.killed, 'SIGKILL');
  h.spawned[0].proc.emit('exit', null);
  await h.warmup.idle();
  assert.strictEqual(h.warmup.isRunning(), false);
});

test('spawn errors and unprepared models are logged, never thrown', async () => {
  const h = harness();
  h.warmup.runNow();
  h.spawned[0].proc.emit('error', new Error('EACCES'));
  await h.warmup.idle();
  assert.ok(h.logs.some((m) => m.includes('EACCES')));

  const h2 = harness();
  h2.warmup.runNow();
  h2.spawned[0].proc.emit('exit', 3);
  await h2.warmup.idle();
  assert.ok(h2.logs.some((m) => m.includes('not prepared')));
});

test('does nothing off macOS or without a bundled sidecar', () => {
  const linux = harness({ platform: 'linux' });
  linux.warmup.schedule();
  assert.strictEqual(linux.timers.length, 0);
  assert.strictEqual(linux.warmup.runNow(), false);
  const missing = harness({ resolveBinary: () => null });
  assert.strictEqual(missing.warmup.runNow(), false);
  assert.strictEqual(missing.spawned.length, 0);
});

test('silentWav writes a valid 16 kHz mono PCM header', () => {
  const wav = silentWav(1);
  assert.strictEqual(wav.length, 44 + 32000);
  assert.strictEqual(wav.readUInt32LE(24), 16000);
  assert.strictEqual(wav.readUInt16LE(22), 1);
  assert.ok(wav.subarray(44).every((b) => b === 0));
});

test('resolveSidecar looks next to the backend, then in _internal', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'steno-sidecar-'));
  fs.mkdirSync(path.join(dir, '_internal'));
  const backendPath = path.join(dir, 'stenoai');
  assert.strictEqual(resolveSidecar({ backendPath }), null);
  const internal = path.join(dir, '_internal', 'steno-diarize');
  fs.writeFileSync(internal, '#!/bin/sh\n', { mode: 0o755 });
  assert.strictEqual(resolveSidecar({ backendPath }), internal);
});

test('main.js gates queue and re-transcription jobs on the warm-up', () => {
  const source = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
  const queue = source.slice(source.indexOf('async function processNextInQueue()'));
  assert.match(queue.slice(0, 6000), /await speakerModelWarmup\.idle\(\)/);
  const reprocess = source.slice(source.indexOf("ipcMain.handle('reprocess-meeting'"));
  assert.match(reprocess.slice(0, 6000), /await speakerModelWarmup\.idle\(\)/);
});
