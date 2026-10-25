'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { registerWatchedFoldersIpc } = require('./watched-folders-ipc');

function harness({ allowPathArg = false, dialogResult = { canceled: false, filePaths: ['/picked'] } } = {}) {
  const handlers = {};
  const calls = [];
  const listing = { folders: [], files: [] };
  const watchedFolders = {
    list: async () => listing,
    addFolder: async (p) => { calls.push(['add', p]); return listing; },
    removeFolder: async (id) => { calls.push(['remove', id]); return listing; },
    setAutoTranscribe: async (id, on) => { calls.push(['auto', id, on]); return listing; },
    transcribe: async (ids) => { calls.push(['transcribe', ids]); throw new Error('Stop the recording first'); },
    dismiss: async (ids) => { calls.push(['dismiss', ids]); return listing; },
    restore: async (ids) => { calls.push(['restore', ids]); return listing; },
  };
  registerWatchedFoldersIpc({
    ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } },
    watchedFolders,
    dialog: { showOpenDialog: async () => { calls.push(['dialog']); return dialogResult; } },
    getMainWindow: () => null,
    allowPathArg,
  });
  return { handlers, calls };
}

test('registers the eight watched-folder channels', () => {
  const { handlers } = harness();
  assert.deepStrictEqual(Object.keys(handlers).sort(), [
    'watched-folders-add', 'watched-folders-dismiss', 'watched-folders-list', 'watched-folders-preview', 'watched-folders-remove',
    'watched-folders-restore', 'watched-folders-set-auto', 'watched-folders-transcribe',
  ]);
});

test('add ignores a renderer path outside e2e and uses the picker', async () => {
  const { handlers, calls } = harness();
  await handlers['watched-folders-add']({}, '/etc');
  assert.deepStrictEqual(calls, [['dialog'], ['add', '/picked']]);
});

test('add accepts a path only in e2e mode', async () => {
  const { handlers, calls } = harness({ allowPathArg: true });
  await handlers['watched-folders-add']({}, '/tmp/phone');
  assert.deepStrictEqual(calls, [['add', '/tmp/phone']]);
});

test('a cancelled picker is not an error', async () => {
  const { handlers } = harness({ dialogResult: { canceled: true, filePaths: [] } });
  assert.deepStrictEqual(await handlers['watched-folders-add']({}), { success: true, cancelled: true, folders: [], files: [] });
});

test('errors come back as { success: false }', async () => {
  const { handlers } = harness();
  assert.deepStrictEqual(await handlers['watched-folders-transcribe']({}, ['a']), { success: false, error: 'Stop the recording first' });
});

test('set-auto only enables on a literal true', async () => {
  const { handlers, calls } = harness();
  await handlers['watched-folders-set-auto']({}, 'f1', 'yes');
  assert.deepStrictEqual(calls, [['auto', 'f1', false]]);
});
