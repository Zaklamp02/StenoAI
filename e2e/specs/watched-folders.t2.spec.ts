import { test, expect } from '../fixtures/electron';
import { realUserDataDir, fileSig } from '../fixtures/real-user-data';
import { makeWav } from '../fixtures/make-wav';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';

/**
 * T2 — watched recording folders + the Recordings inbox. Model-free: nothing is
 * transcribed (auto-transcribe and queueing are covered in
 * app/watched-folders.test.js). Asserts the inbox is hidden until a folder is
 * configured, that a file only becomes "new" once complete, that dismiss and
 * restore never touch the source, and that removing the last folder hides the
 * inbox again.
 */

type Listing = {
  success: boolean;
  error?: string;
  folders: Array<{ id: string; name: string; autoTranscribe: boolean }>;
  files: Array<{ id: string; name: string; status: string }>;
};

type StenoWindow = Window & {
  stenoai: {
    watchedFolders: {
      add: (testPath: string) => Promise<Listing>;
      list: () => Promise<Listing>;
      preview: (id: string) => Promise<{ success: boolean; audioBase64?: string; error?: string }>;
    };
  };
};

test('a watched folder adds the Recordings inbox; files can be dismissed and restored', async ({
  launchApp,
  userDataDir,
}) => {
  test.setTimeout(90_000);
  const realDirBefore = fileSig(realUserDataDir());
  const phone = path.join(path.dirname(userDataDir), `${path.basename(userDataDir)}-phone`);
  mkdirSync(phone, { recursive: true });
  const source = path.join(phone, 'Spraak 261017_191302.m4a');

  const { page } = await launchApp({ releaseHighlightsSeen: true });
  const nav = page.locator('nav').getByRole('button', { name: /^Recordings/ });
  await expect(page.locator('nav').getByRole('button', { name: /^Home/ })).toBeVisible();
  await expect(nav).toHaveCount(0);

  const refused = await page.evaluate(
    (p) => (window as StenoWindow).stenoai.watchedFolders.add(p),
    userDataDir,
  );
  expect(refused.success).toBe(false);

  const added = await page.evaluate((p) => (window as StenoWindow).stenoai.watchedFolders.add(p), phone);
  expect(added.success).toBe(true);
  await expect(nav).toBeVisible();

  // Syncthing's hidden temp file is never listed; the finished file is.
  writeFileSync(path.join(phone, '.syncthing.Spraak 261017_191302.m4a.tmp'), 'partial');
  makeWav(source, { seconds: 1 });

  await nav.click();
  const row = page.locator('[data-watched-file="Spraak 261017_191302.m4a"]');
  await expect(row).toHaveAttribute('data-status', /syncing|new/);
  await expect(row).toHaveAttribute('data-status', 'new', { timeout: 30_000 });
  await expect(page.locator('[data-watched-file]')).toHaveCount(1);
  await expect(page.getByTestId('recordings-new-count')).toHaveText('1');

  // The play button gets a WAV transcode from the bundled ffmpeg.
  const [listed] = (await page.evaluate(() => (window as StenoWindow).stenoai.watchedFolders.list())).files;
  const preview = await page.evaluate((id) => (window as StenoWindow).stenoai.watchedFolders.preview(id), listed.id);
  expect(preview.success).toBe(true);
  expect(Buffer.from(preview.audioBase64!, 'base64').subarray(0, 4).toString()).toBe('RIFF');
  await row.getByRole('button', { name: 'Play the first two minutes' }).click();
  await expect(row.getByRole('button', { name: 'Stop' })).toBeVisible();

  await row.getByRole('button', { name: 'Dismiss' }).click();
  await expect(row).toHaveCount(0);
  await page.getByRole('tab', { name: 'All' }).click();
  await expect(row).toHaveAttribute('data-status', 'dismissed');
  await row.getByRole('button', { name: 'Restore' }).click();
  await expect(row).toHaveAttribute('data-status', 'new');
  expect(existsSync(source)).toBe(true);

  // Settings: the folder is listed and auto-transcribe persists.
  await page.evaluate(() => { window.location.hash = '#/settings?tab=integrations'; });
  const folderRow = page.locator(`[data-watched-folder="${path.basename(phone)}"]`);
  await expect(folderRow).toBeVisible();
  await folderRow.getByRole('switch').click();
  await expect
    .poll(() => {
      const state = JSON.parse(readFileSync(path.join(userDataDir, 'watched-folders.json'), 'utf8'));
      return state.folders[0]?.auto;
    })
    .toBe(true);
  // Turning it on leaves the file that was already there alone.
  const listing = await page.evaluate(() => (window as StenoWindow).stenoai.watchedFolders.list());
  expect(listing.files.map((f) => f.status)).toEqual(['new']);

  // Removing the last folder hides the inbox and sends a stale route Home.
  await folderRow.getByRole('button', { name: 'Remove' }).click();
  await expect(folderRow).toHaveCount(0);
  await expect(nav).toHaveCount(0);
  await page.evaluate(() => { window.location.hash = '#/recordings'; });
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('#/');
  expect(existsSync(source)).toBe(true);

  expect(fileSig(realUserDataDir())).toEqual(realDirBefore);
});
