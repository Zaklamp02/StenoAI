'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { TOAST_WORKSPACE_OPTIONS, activateApp } = require('./mac-window-activation');

test('the toast never turns the app into a Dock-less menu-bar app', () => {
  assert.strictEqual(TOAST_WORKSPACE_OPTIONS.visibleOnFullScreen, true);
  assert.strictEqual(TOAST_WORKSPACE_OPTIONS.skipTransformProcessType, true);
});

test('on macOS an explicit bring-forward activates the app', () => {
  const calls = [];
  assert.strictEqual(activateApp({ focus: (o) => calls.push(o) }, 'darwin'), true);
  assert.deepStrictEqual(calls, [{ steal: true }]);
});

test('elsewhere the window focus alone is enough', () => {
  const calls = [];
  assert.strictEqual(activateApp({ focus: (o) => calls.push(o) }, 'win32'), false);
  assert.deepStrictEqual(calls, []);
});
