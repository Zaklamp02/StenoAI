'use strict';
const fs = require('fs');
const path = require('path');

function registerRecordingRecovery({ ipcMain, journal, resolveRecordingsDir, summaryFileForAudio,
  isBusy, validateSafeFilePath, getAllowedBaseDirs, enqueue }) {
  const startedAt = Date.now();
  function valid(file) {
    return typeof file === 'string' && validateSafeFilePath(file, getAllowedBaseDirs())
      && /\.(webm|wav|m4a|mp3|mp4|ogg|flac|aac|caf)$/i.test(file)
      && fs.lstatSync(file).isFile() && fs.statSync(file).size > 0;
  }
  // A retry that re-imports a recording processes a copy named <stem>-N, so
  // the note lands as <stem>-N_summary.md and the original looks unprocessed.
  function processedAsCopy(file) {
    const summary = summaryFileForAudio(file);
    const stem = path.basename(summary).replace(/_summary\.md$/, '');
    const dir = path.dirname(summary);
    for (let n = 1; n <= 20; n += 1) {
      if (['md', 'json'].some(ext => fs.existsSync(path.join(dir, `${stem}-${n}_summary.${ext}`)))) return true;
    }
    return false;
  }
  // When the recording started: sysaudio files carry it in their name.
  function recordedAt(file) {
    const ms = /sysaudio-(\d{13})-/.exec(path.basename(file));
    return new Date(ms ? Number(ms[1]) : fs.statSync(file).mtimeMs).toISOString();
  }
  function entries() {
    // Adopt captures made before the journal existed. Completed notes are not
    // presented as interrupted recordings, and recent imports get time to queue.
    const dir = resolveRecordingsDir();
    for (const name of fs.readdirSync(dir)) {
      const file = path.join(dir, name);
      if (!/\.(webm|wav|m4a|mp3|mp4|ogg|flac|aac|caf)$/i.test(name) || isBusy(file)) continue;
      try {
        if (valid(file) && fs.statSync(file).mtimeMs < startedAt
            && !fs.existsSync(summaryFileForAudio(file)) && !processedAsCopy(file) && !journal.has(file)) {
          journal.update(file, 'failed', { sessionName: 'Recovered recording', summaryFile: summaryFileForAudio(file) });
        }
      } catch (_) { /* inaccessible files stay protected */ }
    }
    return journal.pending().filter(entry => {
      try {
        // Adopted before the copy check existed: its note is there after all.
        if (entry.state === 'failed' && processedAsCopy(entry.audioFile)) {
          journal.update(entry.audioFile, 'archived');
          return false;
        }
        return valid(entry.audioFile) && !isBusy(entry.audioFile)
        && (entry.owner !== journal.owner || entry.state === 'failed'); }
      catch { return false; }
    });
  }
  ipcMain.handle('list-recoverable-recordings', async () => {
    try {
      return { success: true, recordings: entries().map(e => ({ id: e.id,
        name: e.sessionName || 'Recovered recording', updatedAt: e.updatedAt, recordedAt: recordedAt(e.audioFile),
        bytes: fs.statSync(e.audioFile).size })) };
    } catch (e) { return { success: false, error: e.message }; }
  });
  ipcMain.handle('recover-recording', async (_event, id) => {
    try {
      const entry = entries().find(e => e.id === id);
      if (!entry) return { success: false, error: 'Recording is unavailable or already processing.' };
      const safe = p => typeof p === 'string' && validateSafeFilePath(p, getAllowedBaseDirs());
      enqueue(entry.audioFile, entry.sessionName || 'Recovered recording',
        safe(entry.notesFile) && fs.existsSync(entry.notesFile) ? entry.notesFile : null,
        safe(entry.liveTranscriptFile) && fs.existsSync(entry.liveTranscriptFile) ? entry.liveTranscriptFile : null,
        safe(entry.appendTo) ? entry.appendTo : null, safe(entry.appendTo) ? entry.appendTo : summaryFileForAudio(entry.audioFile));
      return { success: true };
    } catch (_) { return { success: false, error: 'Could not recover this recording. The audio has been kept.' }; }
  });
  ipcMain.handle('dismiss-recoverable-recording', async (_event, id) => {
    try {
      const entry = entries().find(e => e.id === id);
      if (!entry) return { success: false, error: 'Recording is unavailable or already processing.' };
      // Keep audio on disk and protect it from automatic cleanup. Dismissing a
      // banner is not permission to destroy the only copy of a meeting.
      journal.update(entry.audioFile, 'archived');
      return { success: true };
    } catch (_) { return { success: false, error: 'Could not dismiss this recording.' }; }
  });
}
module.exports = { registerRecordingRecovery };
