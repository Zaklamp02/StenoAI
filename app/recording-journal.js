'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Durable ownership of unfinished audio. Unknown files are protected too:
// a missing/corrupt journal must never make old failed recordings disposable.
function createRecordingJournal({ getUserDataDir }) {
  const owner = crypto.randomUUID();
  const file = () => path.join(getUserDataDir(), 'recording-journal.json');
  const idFor = p => crypto.createHash('sha256').update(path.resolve(p)).digest('hex');
  function read() {
    try {
      const data = JSON.parse(fs.readFileSync(file(), 'utf8'));
      if (data.version !== 1 || !data.entries || typeof data.entries !== 'object') throw new Error('Invalid recording journal');
      return data;
    } catch (error) {
      if (error.code === 'ENOENT') return { version: 1, entries: {} };
      throw new Error('Recording recovery information could not be read. Existing audio is protected.');
    }
  }
  function write(data) {
    const dest = file();
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const tmp = `${dest}.${process.pid}.tmp`;
    const fd = fs.openSync(tmp, 'w', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(data)); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    fs.renameSync(tmp, dest);
  }
  function update(audioFile, state, details = {}) {
    if (!audioFile) return;
    const data = read();
    const id = idFor(audioFile);
    data.entries[id] = { ...data.entries[id], ...details, id, owner, audioFile: path.resolve(audioFile), state, updatedAt: new Date().toISOString() };
    write(data);
  }
  function forget(id) {
    const data = read();
    delete data.entries[id];
    write(data);
  }
  function isProtected(audioFile) {
    try { return !['complete', 'dismissed'].includes(read().entries[idFor(audioFile)]?.state); }
    catch { return true; }
  }
  function completeForSummary(summaryFile) {
    const data = read();
    for (const entry of Object.values(data.entries)) {
      if (!entry.appendTo && entry.summaryFile && path.resolve(entry.summaryFile) === path.resolve(summaryFile)
          && (entry.owner !== owner || ['failed', 'archived'].includes(entry.state))) {
        entry.state = 'complete';
        entry.updatedAt = new Date().toISOString();
      }
    }
    write(data);
  }
  function pending() {
    return Object.values(read().entries).filter(e => !['complete', 'dismissed', 'archived'].includes(e.state));
  }
  return { update, forget, isProtected, pending, completeForSummary, idFor, owner, has: p => Boolean(read().entries[idFor(p)]) };
}

module.exports = { createRecordingJournal };
