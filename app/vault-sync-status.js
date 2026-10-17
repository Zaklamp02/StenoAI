'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

// Read-only view of the custom Obsidian sync (custom/obsidian_sync.py, run by
// a LaunchAgent) for one note. Returns null when that sync is not installed,
// so the note shows nothing on Macs without it.
function syncConfigDir(env = process.env) {
  return env.STENOAI_SYNC_CONFIG_DIR || path.join(os.homedir(), '.config', 'stenoai-sync');
}

function vaultSyncStatus({ stem, sourceMtimeMs, configDir = syncConfigDir() }) {
  let state;
  try {
    state = JSON.parse(fs.readFileSync(path.join(configDir, 'state.json'), 'utf8'));
  } catch {
    return null;
  }
  const lastRun = typeof state.last_run === 'string' ? state.last_run : null;
  const error = state.errors?.[stem];
  if (error) return { status: 'error', lastRun, message: String(error.message || 'Sync failed') };
  const entry = state.synced?.[stem];
  if (entry?.waiting_reason) return { status: 'waiting', lastRun, reason: String(entry.waiting_reason) };
  const syncedAtMs = entry?.synced_at ? Date.parse(entry.synced_at) : NaN;
  // A note changed after its last export waits for the next sync run.
  if (!Number.isFinite(syncedAtMs) || (sourceMtimeMs && sourceMtimeMs > syncedAtMs + 1000)) {
    return { status: 'pending', lastRun };
  }
  return { status: 'synced', lastRun, syncedAt: entry.synced_at, notePath: entry.note_rel || null };
}

module.exports = { vaultSyncStatus, syncConfigDir };
