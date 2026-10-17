'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { registerObsidianSync } = require('./obsidian-managed-sync');

test('app-managed sync prepares calendar before export, retries failure, and keeps vault state separate', async () => {
  const calls = [];
  let fail = true;
  const sync = registerObsidianSync({ getUserDataDir: () => '/synthetic',
    prepareCalendar: async () => { calls.push('calendar'); },
    runPythonScript: async (_script, args) => { calls.push(args[0]); if (fail) throw new Error('Unavailable vault'); },
  });
  assert.equal((await sync.backfillAll()).status, 'disabled');
  sync.setCachedConfig({ enabled: true, vaultPath: '/synthetic/vault-one' });
  const first = sync.stateDir();
  assert.equal((await sync.backfillAll()).status, 'error');
  assert.ok(sync.loadIndex().conflicts.runtime);
  fail = false;
  assert.equal((await sync.backfillAll()).status, 'done');
  assert.deepEqual(calls, ['calendar', 'sync-obsidian', 'calendar', 'sync-obsidian']);
  assert.deepEqual(sync.loadIndex().conflicts, {});
  sync.setCachedConfig({ enabled: true, vaultPath: '/synthetic/vault-two' });
  assert.notEqual(sync.stateDir(), first);
  sync.setCachedConfig({ enabled: false });
});
