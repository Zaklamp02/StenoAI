'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createRecordingJournal } = require('./recording-journal');
const { createAudioStorage } = require('./audio-storage');
const { registerRecordingRecovery } = require('./recording-recovery-ipc');

test('paused and failed recordings survive quota enforcement and restart; completed audio can expire', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'journal-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const audio = path.join(dir, 'recordings'); fs.mkdirSync(audio);
  const files = ['paused.webm', 'failed.wav', 'complete.wav', 'new.wav'].map(name => path.join(audio, name));
  for (const file of files) {
    const fd = fs.openSync(file, 'w'); fs.ftruncateSync(fd, 60 * 1024 * 1024); fs.closeSync(fd);
    fs.utimesSync(file, new Date(0), new Date(0));
  }
  fs.utimesSync(files[3], new Date(), new Date());
  const journal = createRecordingJournal({ getUserDataDir: () => dir });
  journal.update(files[0], 'recording'); journal.update(files[1], 'failed'); journal.update(files[2], 'complete');
  const restarted = createRecordingJournal({ getUserDataDir: () => dir });
  const storage = createAudioStorage({ getUserDataDir: () => dir, resolveRecordingsDir: () => audio,
    isProtected: restarted.isProtected });
  storage.setLimitMb(100);
  assert.deepEqual(storage.enforce(), [files[2]]);
  assert.ok(fs.existsSync(files[0])); assert.ok(fs.existsSync(files[1]));
  assert.equal(restarted.pending().length, 2);
  fs.writeFileSync(path.join(dir, 'recording-journal.json'), '{broken');
  assert.deepEqual(storage.enforce(), []);
  assert.throws(() => restarted.pending(), /protected/);
});

test('recovery retains queued notes, live text and continuation target and prevents duplicate enqueue', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recover-context-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const name of ['recordings', 'recovery', 'output']) fs.mkdirSync(path.join(dir, name));
  const audio = path.join(dir, 'recordings', 'segment.webm');
  const notes = path.join(dir, 'recovery', 'notes.txt');
  const live = path.join(dir, 'recovery', 'live.txt');
  const target = path.join(dir, 'output', 'original_summary.md');
  for (const f of [audio, notes, live, target]) fs.writeFileSync(f, 'Synthetic retained content');
  const original = createRecordingJournal({ getUserDataDir: () => dir });
  original.update(audio, 'queued', { sessionName: 'Fixture', notesFile: notes, liveTranscriptFile: live, appendTo: target });
  const journal = createRecordingJournal({ getUserDataDir: () => dir });
  const handlers = {}, jobs = [];
  registerRecordingRecovery({ ipcMain: { handle: (name, fn) => { handlers[name] = fn; } }, journal,
    resolveRecordingsDir: () => path.join(dir, 'recordings'),
    summaryFileForAudio: () => path.join(dir, 'output', 'segment_summary.md'),
    isBusy: file => jobs.some(job => job[0] === file),
    validateSafeFilePath: file => fs.realpathSync(file).startsWith(fs.realpathSync(dir) + path.sep), getAllowedBaseDirs: () => [dir],
    enqueue: (...args) => jobs.push(args),
  });
  assert.equal((await handlers['list-recoverable-recordings']()).recordings.length, 1);
  assert.equal((await handlers['recover-recording']({}, journal.idFor(audio))).success, true);
  assert.deepEqual(jobs, [[audio, 'Fixture', notes, live, target, target]]);
  assert.equal((await handlers['recover-recording']({}, journal.idFor(audio))).success, false);
  assert.equal(jobs.length, 1);
  // Re-transcribing the original note cannot mark an unprocessed continuation done.
  journal.completeForSummary(target);
  assert.equal(journal.isProtected(audio), true);
  original.update(audio, 'failed', { appendTo: null, summaryFile: target });
  journal.completeForSummary(target);
  assert.equal(journal.isProtected(audio), false);
});
