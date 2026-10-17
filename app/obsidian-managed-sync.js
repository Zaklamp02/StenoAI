'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

// All triggers use the same bundled Python exporter. Its file lock also
// serializes an existing standalone scheduler when adopting that setup.
function registerObsidianSync({ getUserDataDir, runPythonScript, prepareCalendar = async () => {}, sendDebugLog = () => {} }) {
  let cached = { enabled: false, vaultPath: '' };
  let running = null;
  let queued = false;
  let timer = null;
  let debounce = null;
  let lastError = null;
  const active = () => cached.enabled && Boolean(cached.vaultPath);
  function stateDir() {
    const legacy = process.env.STENOAI_SYNC_CONFIG_DIR || path.join(os.homedir(), '.config', 'stenoai-sync');
    if (!process.env.STENOAI_USER_DATA_DIR || process.env.STENOAI_SYNC_CONFIG_DIR) {
      try {
        const config = JSON.parse(fs.readFileSync(path.join(legacy, 'config.json'), 'utf8'));
        if (path.resolve(config.vault) === path.resolve(cached.vaultPath)) return legacy;
      } catch (_) { /* no existing standalone setup */ }
    }
    const id = crypto.createHash('sha256').update(path.resolve(cached.vaultPath || '.')).digest('hex').slice(0, 16);
    return path.join(getUserDataDir(), 'obsidian-sync', id);
  }
  function loadIndex() {
    let data = {};
    try { data = JSON.parse(fs.readFileSync(path.join(stateDir(), 'state.json'), 'utf8')); } catch (_) {}
    const conflicts = Object.fromEntries(Object.entries(data.errors || {}).map(([stem, e]) => [stem, {
      vaultRelPath: '', detectedAt: e.at, reason: e.message,
    }]));
    if (lastError) conflicts.runtime = { vaultRelPath: '', detectedAt: new Date().toISOString(), reason: lastError };
    return { ...data, conflicts };
  }
  function backfillAll() {
    if (!active()) return Promise.resolve({ status: 'disabled' });
    if (running) { queued = true; return running; }
    running = (async () => {
      do {
        queued = false;
        try {
          await prepareCalendar();
          if (!active()) break;
          await runPythonScript('simple_recorder.py', ['sync-obsidian', '--state-dir', stateDir()], true);
          lastError = null;
        } catch (_) {
          lastError = 'Vault sync could not finish. Check the vault is available and retry.';
          sendDebugLog('[obsidian-sync] export failed; will retry');
        }
      } while (queued && active());
      return { status: lastError ? 'error' : 'done' };
    })().finally(() => { running = null; });
    return running;
  }
  function schedule() {
    if (!active()) return { status: 'disabled' };
    clearTimeout(debounce);
    debounce = setTimeout(() => { void backfillAll(); }, 1000);
    debounce.unref?.();
    return { status: 'queued' };
  }
  function setCachedConfig(config) {
    cached = { enabled: config?.enabled === true, vaultPath: config?.vaultPath || '' };
    clearInterval(timer);
    if (active()) {
      timer = setInterval(() => { void backfillAll(); }, 60_000);
      timer.unref?.();
    }
  }
  return { setCachedConfig, getCachedConfig: () => cached, stateDir, loadIndex,
    backfillAll, reconcileOnLaunch: backfillAll, syncNoteBySummaryPath: schedule,
    // Exported notes are user-owned archive material; deleting a source never
    // destroys notes/annotations already in the vault.
    removeNoteBySummaryPath: () => ({ status: 'preserved' }) };
}
module.exports = { registerObsidianSync };
