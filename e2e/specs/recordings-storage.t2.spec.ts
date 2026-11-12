import { test, expect } from '../fixtures/electron';
import { mkdirSync, utimesSync, writeFileSync } from 'fs';
import path from 'path';

/**
 * T2 — Settings -> General -> Saved recordings reads the real recordings
 * folder: how many audio files are kept, their size and the oldest one's date.
 * Opening the folder is recorded under E2E instead of opening Finder.
 */
function seed(userDataDir: string) {
  writeFileSync(
    path.join(userDataDir, 'config.json'),
    JSON.stringify({
      telemetry_enabled: false,
      privacy_notice_seen: true,
      auto_detect_meetings_enabled: false,
      launch_on_login: false,
      keep_recordings: true,
      auto_summarize_enabled: false,
      transcription_engine: 'whisper',
      ai_provider: 'cloud',
    }),
  );
}

test('the storage summary counts kept audio on disk and the folder opens', async ({ launchApp, userDataDir }) => {
  seed(userDataDir);
  const recordings = path.join(userDataDir, 'recordings');
  mkdirSync(recordings, { recursive: true });
  const oldest = new Date('2026-10-03T09:00:00Z');
  writeFileSync(path.join(recordings, 'a.wav'), Buffer.alloc(3000));
  utimesSync(path.join(recordings, 'a.wav'), oldest, oldest);
  writeFileSync(path.join(recordings, 'b.webm'), Buffer.alloc(2000));
  // Not audio: not counted.
  writeFileSync(path.join(recordings, 'notes.txt'), 'x');

  const { app, page } = await launchApp({ releaseHighlightsSeen: true });
  const storage = await page.evaluate(() => window.stenoai.settings.getAudioStorage());
  expect(storage).toMatchObject({
    success: true,
    usedBytes: 5000,
    count: 2,
    oldestAt: oldest.toISOString(),
  });

  const opened = await page.evaluate(() => window.stenoai.settings.openRecordingsFolder());
  expect(opened.success).toBe(true);
  const folder = await app.evaluate(
    () => (globalThis as unknown as { __openedRecordingsFolder?: string }).__openedRecordingsFolder,
  );
  expect(folder).toBe(recordings);
});
