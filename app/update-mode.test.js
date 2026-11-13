'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { updaterOptionsFor, canUpdateInApp } = require('./update-mode');

test('automatic installs download in the background and install on quit', () => {
  assert.deepStrictEqual(updaterOptionsFor(true), { autoDownload: true, autoInstallOnAppQuit: true });
  // The setting defaults to on, so an unset value is automatic too.
  assert.deepStrictEqual(updaterOptionsFor(undefined), { autoDownload: true, autoInstallOnAppQuit: true });
});

test('ask first downloads nothing and installs only on Restart', () => {
  assert.deepStrictEqual(updaterOptionsFor(false), { autoDownload: false, autoInstallOnAppQuit: false });
});

test('only a full release on a self-updating install updates in the app', () => {
  const ok = { autoUpdateEnabled: true, prerelease: false, updateError: null, feedMissing: false };
  assert.strictEqual(canUpdateInApp(ok), true);
  assert.strictEqual(canUpdateInApp({ ...ok, autoUpdateEnabled: false }), false);
  assert.strictEqual(canUpdateInApp({ ...ok, prerelease: true }), false);
  assert.strictEqual(canUpdateInApp({ ...ok, updateError: 'The download failed.' }), false);
  assert.strictEqual(canUpdateInApp({ ...ok, feedMissing: true }), false);
});
