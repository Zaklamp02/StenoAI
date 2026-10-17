'use strict';

const fs = require('fs');
const path = require('path');

// Optional cap on the disk space kept recordings may use. When the folder
// grows past it, the oldest audio files go first; notes and transcripts stay.
// Off (no limit) unless the user sets one.
const AUDIO_EXTENSIONS = new Set(['.webm', '.wav', '.m4a', '.mp3', '.mp4', '.ogg', '.flac', '.aac', '.caf']);
// A file written this recently may still be recording or being imported.
const RECENT_MS = 15 * 60 * 1000;
const MIN_LIMIT_MB = 100;

function createAudioStorage({ getUserDataDir, resolveRecordingsDir, isProtected = () => false, now = Date.now }) {
  const file = () => path.join(getUserDataDir(), 'audio-storage.json');

  function getLimitMb() {
    try {
      const { limitMb } = JSON.parse(fs.readFileSync(file(), 'utf8'));
      return Number.isFinite(limitMb) && limitMb >= MIN_LIMIT_MB ? limitMb : null;
    } catch {
      return null;
    }
  }

  function setLimitMb(limitMb) {
    if (limitMb !== null && !(Number.isFinite(limitMb) && limitMb >= MIN_LIMIT_MB)) {
      throw new Error('Invalid limit');
    }
    const target = file();
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(`${target}.tmp`, JSON.stringify({ limitMb }), { mode: 0o600 });
    fs.renameSync(`${target}.tmp`, target);
  }

  function listAudio() {
    const dir = resolveRecordingsDir();
    const files = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !AUDIO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
      const full = path.join(dir, entry.name);
      try {
        const stat = fs.statSync(full);
        files.push({ path: full, bytes: stat.size, mtimeMs: stat.mtimeMs });
      } catch { /* vanished */ }
    }
    return files.sort((a, b) => a.mtimeMs - b.mtimeMs);
  }

  function usedBytes() {
    return listAudio().reduce((sum, f) => sum + f.bytes, 0);
  }

  // Delete oldest-first until the folder fits. The newest recording, files
  // still being written and files a job is using are never deleted, so the
  // folder can stay above the limit until those are done.
  function enforce() {
    const limitMb = getLimitMb();
    if (limitMb === null) return [];
    const files = listAudio();
    let total = files.reduce((sum, f) => sum + f.bytes, 0);
    const limit = limitMb * 1024 * 1024;
    const deleted = [];
    for (const f of files.slice(0, -1)) {
      if (total <= limit) break;
      if (now() - f.mtimeMs < RECENT_MS || isProtected(f.path)) continue;
      try {
        fs.unlinkSync(f.path);
        total -= f.bytes;
        deleted.push(f.path);
      } catch { /* in use or already gone: try the next one */ }
    }
    return deleted;
  }

  return { getLimitMb, setLimitMb, usedBytes, enforce };
}

module.exports = { createAudioStorage, MIN_LIMIT_MB };
