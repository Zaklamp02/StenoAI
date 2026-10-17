'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createCloudConcurrency, DEFAULT_CONCURRENCY, MAX_CONCURRENCY } = require('./cloud-concurrency');

function store() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'steno-concurrency-'));
  return { dir, concurrency: createCloudConcurrency({ getUserDataDir: () => dir }) };
}

test('defaults to six requests when nothing is saved', () => {
  const { concurrency } = store();
  assert.strictEqual(DEFAULT_CONCURRENCY, 6);
  assert.strictEqual(concurrency.get(), 6);
  assert.strictEqual(concurrency.env(), '6');
});

test('saved value round-trips and becomes the env value', () => {
  const { dir, concurrency } = store();
  concurrency.set(10);
  assert.strictEqual(concurrency.get(), 10);
  assert.strictEqual(concurrency.env(), '10');
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'cloud-concurrency.json'), 'utf8')), { concurrency: 10 });
});

test('accepts the full 1-12 range and rejects anything else', () => {
  const { concurrency } = store();
  concurrency.set(1);
  assert.strictEqual(concurrency.get(), 1);
  concurrency.set(MAX_CONCURRENCY);
  assert.strictEqual(concurrency.get(), 12);
  for (const bad of [0, 13, -1, 2.5, NaN, '6', null, undefined]) {
    assert.throws(() => concurrency.set(bad), /Invalid concurrency/);
  }
  assert.strictEqual(concurrency.get(), 12);
});

test('a corrupt or out-of-range file falls back to the default', () => {
  const { dir, concurrency } = store();
  fs.writeFileSync(path.join(dir, 'cloud-concurrency.json'), '{not json');
  assert.strictEqual(concurrency.get(), 6);
  fs.writeFileSync(path.join(dir, 'cloud-concurrency.json'), JSON.stringify({ concurrency: 40 }));
  assert.strictEqual(concurrency.get(), 6);
});

test('getTranscriptionEnv passes the setting through STENOAI_OAI_PARALLELISM', () => {
  const source = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
  const body = source.slice(source.indexOf('function getTranscriptionEnv()'));
  const fn = body.slice(0, body.indexOf('\n}\n'));
  assert.match(fn, /env\.STENOAI_OAI_PARALLELISM = cloudConcurrency\.env\(\);/);
  assert.doesNotMatch(fn, /STENOAI_OAI_PARALLELISM = '6'/);
});
