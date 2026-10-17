'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createAudioStorage } = require('./audio-storage');

const MB = 1024 * 1024;
const NOW = Date.parse('2026-10-17T12:00:00Z');

function withFolder(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'audio-storage-'));
  const recordings = path.join(root, 'recordings');
  fs.mkdirSync(recordings);
  const add = (name, mb, hoursAgo) => {
    const p = path.join(recordings, name);
    fs.writeFileSync(p, Buffer.alloc(mb * MB));
    const t = new Date(NOW - hoursAgo * 3600 * 1000);
    fs.utimesSync(p, t, t);
    return p;
  };
  try {
    fn({ root, recordings, add });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const storageFor = (root, recordings, isProtected) => createAudioStorage({
  getUserDataDir: () => root,
  resolveRecordingsDir: () => recordings,
  isProtected,
  now: () => NOW,
});

test('no limit means nothing is deleted', () => withFolder(({ root, recordings, add }) => {
  add('a.webm', 2, 48);
  const storage = storageFor(root, recordings);
  assert.equal(storage.getLimitMb(), null);
  assert.deepEqual(storage.enforce(), []);
}));

test('oldest audio goes first until the folder fits', () => withFolder(({ root, recordings, add }) => {
  const oldest = add('a.webm', 60, 72);
  const middle = add('b.webm', 60, 48);
  add('c.webm', 60, 24);
  fs.writeFileSync(path.join(recordings, 'notes.txt'), 'kept');
  const storage = storageFor(root, recordings);
  storage.setLimitMb(130);
  assert.deepEqual(storage.enforce(), [oldest]);
  assert.ok(fs.existsSync(middle));
  assert.equal(storage.usedBytes(), 120 * MB);
  assert.ok(fs.existsSync(path.join(recordings, 'notes.txt')));
}));

test('newest, recent and in-use files are kept even above the limit', () => withFolder(({ root, recordings, add }) => {
  const busy = add('a.webm', 80, 72);
  add('b.webm', 80, 0.1);
  add('c.webm', 80, 0.05);
  const storage = storageFor(root, recordings, (p) => p === busy);
  storage.setLimitMb(100);
  assert.deepEqual(storage.enforce(), []);
}));

test('rejects a limit below the minimum', () => withFolder(({ root, recordings }) => {
  const storage = storageFor(root, recordings);
  assert.throws(() => storage.setLimitMb(10), /Invalid limit/);
  storage.setLimitMb(null);
  assert.equal(storage.getLimitMb(), null);
}));
