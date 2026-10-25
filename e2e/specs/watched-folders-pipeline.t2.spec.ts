import { test, expect } from '../fixtures/electron';
import { startMockOllama } from '../fixtures/mock-ollama';
import { makeWav } from '../fixtures/make-wav';
import { realUserDataDir, fileSig } from '../fixtures/real-user-data';
import { selectEngine, isEngineModelReady, E2E_ENGINE } from '../fixtures/engine';
import { killOllama } from '../fixtures/kill-ollama';
import { existsSync, mkdirSync, readFileSync } from 'fs';
import path from 'path';

/**
 * T2 — auto-transcribe from a watched folder (@pipeline). A file that arrives
 * after auto-transcribe is switched on is processed on its own, becomes a note
 * dated by the timestamp in its name (not by when it was processed), and the
 * source file stays where it was. Needs the transcription model, like
 * audio-import.t2.
 */

type Listing = {
  success: boolean;
  folders: Array<{ id: string }>;
  files: Array<{ name: string; status: string; summaryFile?: string }>;
};

type StenoWindow = Window & {
  stenoai: {
    watchedFolders: {
      add: (testPath: string) => Promise<Listing>;
      list: () => Promise<Listing>;
      setAutoTranscribe: (id: string, enabled: boolean) => Promise<Listing>;
    };
  };
};

test('@pipeline auto-transcribe turns a newly synced recording into a note dated when it was recorded', async ({
  launchApp,
  userDataDir,
}) => {
  test.setTimeout(240_000);
  killOllama();
  const ollama = await startMockOllama();
  const realDirBefore = fileSig(realUserDataDir());
  try {
    const { page } = await launchApp({ releaseHighlightsSeen: true });
    await selectEngine(page);
    const modelReady = await isEngineModelReady(page);
    test.skip(!modelReady, `${E2E_ENGINE} model not installed`);

    const phone = path.join(path.dirname(userDataDir), `${path.basename(userDataDir)}-phone`);
    mkdirSync(phone, { recursive: true });
    const added = await page.evaluate((p) => (window as StenoWindow).stenoai.watchedFolders.add(p), phone);
    expect(added.success).toBe(true);
    const on = await page.evaluate(
      (id) => (window as StenoWindow).stenoai.watchedFolders.setAutoTranscribe(id, true),
      added.folders[0].id,
    );
    expect(on.success).toBe(true);

    const source = path.join(phone, 'Spraak 261017_191302.wav');
    makeWav(source, { seconds: 5 });

    const summary = path.join(userDataDir, 'output', 'Spraak 261017_191302_summary.md');
    await expect.poll(() => existsSync(summary), { timeout: 180_000, intervals: [1000] }).toBe(true);
    expect(readFileSync(summary, 'utf8')).toMatch(/^date: "2026-10-17T19:13:02"$/m);
    await expect
      .poll(async () => (await page.evaluate(() => (window as StenoWindow).stenoai.watchedFolders.list())).files[0]?.status)
      .toBe('done');
    expect(existsSync(source)).toBe(true);
    expect(fileSig(realUserDataDir())).toBe(realDirBefore);
  } finally {
    await ollama.close();
    killOllama();
  }
});
