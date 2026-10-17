'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { vaultSyncStatus } = require('./vault-sync-status');

function withState(state, fn) {
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-sync-'));
  try {
    if (state) fs.writeFileSync(path.join(configDir, 'state.json'), JSON.stringify(state));
    fn(configDir);
  } finally {
    fs.rmSync(configDir, { recursive: true, force: true });
  }
}

test('no sync installed shows nothing', () => withState(null, (configDir) => {
  assert.equal(vaultSyncStatus({ stem: 'a', configDir }), null);
}));

test('synced, pending, waiting and error states', () => withState({
  last_run: '2026-10-17T11:58:03',
  synced: {
    a: { synced_at: '2026-10-17T11:00:00', note_rel: 'StenoAI/Meeting notes/a.md' },
    b: { waiting_hash: 'x', waiting_reason: 'still processing' },
    c: { synced_at: '2026-10-17T11:00:00' },
  },
  errors: { d: { at: '2026-10-17T11:58:03', message: 'disk full' } },
}, (configDir) => {
  assert.equal(vaultSyncStatus({ stem: 'a', configDir, sourceMtimeMs: Date.parse('2026-10-17T10:00:00') }).status, 'synced');
  assert.equal(vaultSyncStatus({ stem: 'b', configDir }).reason, 'still processing');
  assert.equal(vaultSyncStatus({ stem: 'c', configDir, sourceMtimeMs: Date.parse('2026-10-17T12:00:00') }).status, 'pending');
  assert.equal(vaultSyncStatus({ stem: 'd', configDir }).message, 'disk full');
  assert.equal(vaultSyncStatus({ stem: 'new', configDir }).status, 'pending');
}));
