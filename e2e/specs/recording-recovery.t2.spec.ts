import { test, expect } from '../fixtures/electron';
import { existsSync, mkdirSync, writeFileSync, readFileSync, openSync, ftruncateSync, closeSync, utimesSync } from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { makeWav } from '../fixtures/make-wav';

function seed(userDataDir: string) {
  writeFileSync(path.join(userDataDir, 'config.json'), JSON.stringify({
    telemetry_enabled: false, privacy_notice_seen: true,
    auto_detect_meetings_enabled: false, launch_on_login: false,
    keep_recordings: true, auto_summarize_enabled: false,
    transcription_engine: 'whisper', ai_provider: 'cloud',
    identity_matching_enabled: false, identity_matching_privacy_default_version: 1,
  }));
  mkdirSync(path.join(userDataDir, 'recordings'), { recursive: true });
  mkdirSync(path.join(userDataDir, 'output'), { recursive: true });
}

test('storage cleanup protects a paused open recording', async ({ launchApp, userDataDir }) => {
  seed(userDataDir);
  const { page } = await launchApp({ releaseHighlightsSeen: true });
  const opened = await page.evaluate(() => window.stenoai.recording.openSystemAudioFile('Synthetic paused recording'));
  expect(opened.success).toBe(true);
  await page.evaluate(() => window.stenoai.recording.appendSystemAudioChunk(new Uint8Array([1, 2, 3, 4])));
  // The open recording has been paused for more than the cleanup grace period.
  // Sparse bytes reproduce quota accounting without allocating real audio.
  const fd = openSync(opened.filePath!, 'r+');
  ftruncateSync(fd, 101 * 1024 * 1024);
  closeSync(fd);
  const old = new Date(Date.now() - 20 * 60 * 1000);
  utimesSync(opened.filePath!, old, old);
  // A newer imported recording makes the open recording eligible by age/order.
  writeFileSync(path.join(userDataDir, 'recordings', 'newer-import.wav'), 'synthetic');
  const limit = await page.evaluate(() => window.stenoai.settings.setAudioStorage(100));
  expect(limit.success).toBe(true);
  const append = await page.evaluate(() => window.stenoai.recording.appendSystemAudioChunk(new Uint8Array([5, 6])));
  const closed = await page.evaluate(() => window.stenoai.recording.closeSystemAudioFile());
  const result = { fileStillExists: existsSync(opened.filePath!), appendSucceeded: append.success, closeSucceeded: closed.success };
  console.log('OPEN_RECORDING_QUOTA_REPRO', JSON.stringify(result));
  expect(result).toEqual({ fileStillExists: true, appendSucceeded: true, closeSucceeded: true });
});

test('restart discovers unfinished audio and dismissal keeps it', async ({ launchApp, userDataDir }) => {
  seed(userDataDir);
  const recording = path.join(userDataDir, 'recordings', 'sysaudio-1792240000000-Synthetic_crash.webm');
  writeFileSync(recording, Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3]));
  writeFileSync(path.join(userDataDir, '.recording-active'), '1792240000000');
  const { page } = await launchApp({ releaseHighlightsSeen: true });
  const meetings = await page.evaluate(() => window.stenoai.meetings.list());
  await expect.poll(() => existsSync(path.join(userDataDir, '.recording-active'))).toBe(false);
  console.log('CRASH_RECOVERY_REPRO', JSON.stringify({ audioRetained: existsSync(recording), markerCleared: true, meetings }));
  expect(existsSync(recording)).toBe(true);
  expect(meetings.success).toBe(true);
  expect(meetings.meetings).toHaveLength(0);
  const pending = await page.evaluate(() => window.stenoai.recording.recoverable());
  expect(pending.success).toBe(true);
  if (!pending.success) throw new Error('No recovery response');
  expect(pending.recordings).toHaveLength(1);
  await expect(page.getByRole('region', { name: 'Recording recovery' })).toBeVisible();
  const result = await page.evaluate(id => window.stenoai.recording.dismissRecovery(id), pending.recordings[0].id);
  expect(result.success).toBe(true);
  expect(existsSync(recording)).toBe(true);
  const after = await page.evaluate(() => window.stenoai.recording.recoverable());
  expect(after.success && after.recordings.length).toBe(0);
  expect((await page.evaluate(() => window.stenoai.recording.recover('invalid-id'))).success).toBe(false);
});


test('a recording whose retry copy became a note is not offered for recovery', async ({ launchApp, userDataDir }) => {
  seed(userDataDir);
  const old = new Date(Date.now() - 60 * 60 * 1000);
  const processed = path.join(userDataDir, 'recordings', 'sysaudio-1792058617597-Note.webm');
  const unprocessed = path.join(userDataDir, 'recordings', 'sysaudio-1792141118993-Note.webm');
  for (const file of [processed, unprocessed]) {
    writeFileSync(file, Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3]));
    utimesSync(file, old, old);
  }
  // The retry processed a copy (<stem>-1); its note exists, the original's doesn't.
  writeFileSync(path.join(userDataDir, 'output', 'sysaudio-1792058617597-Note-1_summary.md'), '---\ntitle: "Done"\n---\n');
  const { page } = await launchApp({ releaseHighlightsSeen: true });
  const pending = await page.evaluate(() => window.stenoai.recording.recoverable());
  if (!pending.success) throw new Error('No recovery response');
  expect(pending.recordings).toHaveLength(1);
  expect(pending.recordings[0].recordedAt).toBe(new Date(1792141118993).toISOString());
  const card = page.getByRole('region', { name: 'Recording recovery' });
  await expect(card).toBeVisible();
  await expect(card.locator('[data-recovery-entry]')).toHaveCount(1);
  expect(existsSync(processed)).toBe(true);
});

test('capture diagnostics omit titles when copied and saved', async ({ launchApp, userDataDir }) => {
  seed(userDataDir);
  const diagnosticPath = path.join(userDataDir, 'diagnostics.txt');
  const { app, page } = await launchApp({ releaseHighlightsSeen: true, env: { STENOAI_E2E_DIAGNOSTICS_PATH: diagnosticPath } });
  await page.evaluate(async () => {
    await window.stenoai.recording.openSystemAudioFile('CONFIDENTIAL_BOARD_FIXTURE');
    await window.stenoai.recording.appendSystemAudioChunk(new Uint8Array([1, 2, 3]));
    await window.stenoai.recording.closeSystemAudioFile();
    window.location.hash = '#/settings?tab=developer';
  });
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => existsSync(diagnosticPath)).toBe(true);
  expect(readFileSync(diagnosticPath, 'utf8')).not.toContain('CONFIDENTIAL_BOARD_FIXTURE');
  await page.getByRole('button', { name: 'Copy', exact: true }).click();
  // The copy lands asynchronously; wait for it instead of reading once.
  const readClipboard = () => app.evaluate(({ clipboard }) => clipboard.readText());
  await expect.poll(readClipboard).toContain('[sysaudio]');
  expect(await readClipboard()).not.toContain('CONFIDENTIAL_BOARD_FIXTURE');
});


test('Recover processes retained notes and live text while preserving fallback audio', async ({ launchApp, userDataDir }) => {
  test.setTimeout(90_000);
  seed(userDataDir);
  const stem = 'recovered-fixture';
  const audio = path.join(userDataDir, 'recordings', stem + '.wav');
  makeWav(audio, { seconds: 2, channels: 2, amplitude: 0 });
  const recovery = path.join(userDataDir, 'recovery');
  mkdirSync(recovery);
  const notes = path.join(recovery, 'notes.txt'), live = path.join(recovery, 'live.txt');
  writeFileSync(notes, 'Saved handwritten notes.');
  writeFileSync(live, 'The retained live transcript contains the team decision to finish the synthetic release.');
  const summary = path.join(userDataDir, 'output', stem + '_summary.md');
  const id = createHash('sha256').update(audio).digest('hex');
  writeFileSync(path.join(userDataDir, 'recording-journal.json'), JSON.stringify({ version: 1, entries: {
    [id]: { id, owner: 'previous-app-instance', audioFile: audio, state: 'queued',
      sessionName: 'Synthetic recovery', notesFile: notes, liveTranscriptFile: live, summaryFile: summary },
  } }));
  const { page } = await launchApp({ releaseHighlightsSeen: true });
  expect((await page.evaluate(id => window.stenoai.recording.recover(id), id)).success).toBe(true);
  await expect.poll(() => existsSync(summary) && readFileSync(summary, 'utf8'), { timeout: 60_000 }).toContain('Saved handwritten notes.');
  expect(readFileSync(summary, 'utf8')).toContain('retained live transcript');
  expect(readFileSync(summary, 'utf8')).toContain('is_live_transcript: true');
  await expect.poll(() => JSON.parse(readFileSync(path.join(userDataDir, 'recording-journal.json'), 'utf8')).entries[id].state).toBe('failed');
  expect(existsSync(audio)).toBe(true);
  expect(existsSync(notes)).toBe(true);
  expect(existsSync(live)).toBe(true);
});
