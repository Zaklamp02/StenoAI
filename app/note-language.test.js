'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createNoteLanguages, isLanguageCode, noteStem } = require('./note-language');

function withStore(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'note-lang-'));
  try {
    fn(createNoteLanguages(() => dir), dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('recording, transcript and summary share one key', () => withStore((store) => {
  assert.equal(noteStem('/x/output/sysaudio-1-Note_summary.md'), 'sysaudio-1-Note');
  assert.equal(noteStem('/x/recordings/sysaudio-1-Note.webm'), 'sysaudio-1-Note');
  store.set('/x/recordings/sysaudio-1-Note.webm', 'nl');
  assert.equal(store.get('/y/output/sysaudio-1-Note_summary.md'), 'nl');
}));

test('auto removes the override and leaves other notes alone', () => withStore((store) => {
  store.set('a_summary.md', 'en');
  store.set('b_summary.md', 'nl');
  store.set('a_summary.md', 'auto');
  assert.equal(store.get('a_summary.md'), null);
  assert.equal(store.get('b_summary.md'), 'nl');
}));

test('only a valid code reaches the backend env', () => withStore((store) => {
  assert.deepEqual(store.env('c_summary.md'), {});
  store.set('c_summary.md', 'zh-Hant');
  assert.deepEqual(store.env('c_summary.md'), { STENOAI_LANGUAGE_OVERRIDE: 'zh-Hant' });
  assert.throws(() => store.set('c_summary.md', 'nl; rm -rf'), /Invalid language/);
  assert.equal(isLanguageCode('EN'), false);
}));

test('a corrupt file reads as no overrides', () => withStore((store, dir) => {
  fs.writeFileSync(path.join(dir, 'note-languages.json'), '{oops');
  assert.equal(store.get('a_summary.md'), null);
}));
