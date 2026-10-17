'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { createKeychainGate } = require('./keychain-gate');

function harness({ file = '/data/.cloud-api-key', decrypt } = {}) {
  const states = [];
  const decrypted = [];
  const timers = [];
  const gate = createKeychainGate({
    findEncryptedFile: () => file,
    decryptFile: decrypt || ((f) => { decrypted.push(f); }),
    notify: (s) => states.push(s),
    setTimer: (fn, ms) => { timers.push({ fn, ms }); },
  });
  return { gate, states, decrypted, timers };
}

test('starts closed and touches nothing until opened', () => {
  const h = harness();
  assert.strictEqual(h.gate.isOpen(), false);
  assert.strictEqual(h.gate.getState(), 'closed');
  assert.deepStrictEqual(h.decrypted, []);
  assert.deepStrictEqual(h.states, []);
});

test('announces waiting, lets the renderer paint, then decrypts once and opens', async () => {
  const h = harness();
  const opened = h.gate.open('window shown');
  assert.deepStrictEqual(h.states, ['waiting']);
  assert.strictEqual(h.decrypted.length, 0, 'no Keychain access before the paint delay');
  assert.strictEqual(h.timers[0].ms, 200);
  const again = h.gate.whenOpen('job');
  h.timers[0].fn();
  await opened;
  await again;
  assert.deepStrictEqual(h.decrypted, ['/data/.cloud-api-key']);
  assert.deepStrictEqual(h.states, ['waiting', 'open']);
  assert.strictEqual(h.gate.isOpen(), true);
  await h.gate.open('later');
  assert.strictEqual(h.decrypted.length, 1, 'the probe runs once');
});

test('opens at once without any Keychain access when no key is stored', async () => {
  const h = harness({ file: null });
  await h.gate.open('window shown');
  assert.strictEqual(h.timers.length, 0);
  assert.deepStrictEqual(h.decrypted, []);
  assert.deepStrictEqual(h.states, ['open']);
});

test('a denied or failed decrypt still opens the gate', async () => {
  const h = harness({ decrypt: () => { throw new Error('User canceled'); } });
  const opened = h.gate.open();
  h.timers[0].fn();
  await opened;
  assert.strictEqual(h.gate.isOpen(), true);
});

test('onOpen waits for the gate without opening it', async () => {
  const h = harness({ file: null });
  let ran = 0;
  h.gate.onOpen(() => { ran++; });
  assert.strictEqual(ran, 0);
  assert.strictEqual(h.gate.getState(), 'closed');
  await h.gate.open();
  assert.strictEqual(ran, 1);
  h.gate.onOpen(() => { ran++; });
  assert.strictEqual(ran, 2);
});

test('main.js keeps Keychain reads behind the gate and opens it after the window shows', () => {
  const source = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
  const fn = (name) => {
    const start = source.indexOf(`function ${name}(`);
    assert.ok(start >= 0, `${name} exists`);
    return source.slice(start, source.indexOf('\n}\n', start));
  };
  for (const loader of ['loadCloudApiKey', 'loadGoogleTokens', 'loadOutlookTokens', 'loadOrgSessionEx', 'loadOpenAiAsrCredential']) {
    assert.match(fn(loader), /keychainGate\.isOpen\(\)/, `${loader} checks the gate`);
  }
  assert.doesNotMatch(fn('loadIdentitySuperProperties'), /load(Google|Outlook)Tokens\(\)/,
    'telemetry only checks token files exist');
  assert.match(fn('createWindow'), /mainWindow\.on\('show'[\s\S]*keychainGate\.open/);
  const startup = source.slice(source.indexOf('app.whenReady().then('));
  const beforeWindow = startup.slice(0, startup.indexOf('createWindow();'));
  assert.doesNotMatch(beforeWindow, /^\s*void migrateLegacyOpenAiAsrApiKey\(\);/m,
    'the legacy-key migration no longer runs directly before the window');
  assert.match(beforeWindow, /keychainGate\.onOpen\(\(\) => \{ void migrateLegacyOpenAiAsrApiKey\(\); \}\)/);
});
