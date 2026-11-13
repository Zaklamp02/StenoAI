import type { ElectronApplication } from '@playwright/test';
import { test, expect } from '../fixtures/electron';

/**
 * T1 — mock IPC. New releases are announced by the background check's pill
 * (seeded via STENOAI_E2E_SEED_RELEASE_NOTICE) and the About tab's manual check
 * (STENOAI_E2E_SEED_UPDATE_AVAILABLE). An install that cannot update itself
 * downloads the DMG from GitHub; one that can follows electron-updater's
 * events, driven here on the real update-* channels. See app/e2e-mock-ipc.js.
 */
const releasePages = (app: ElectronApplication) =>
  app.evaluate(() => (globalThis as unknown as { __openedReleasePages?: string[] }).__openedReleasePages ?? []);

// What main.js's autoUpdater listeners send the window.
const sendUpdaterEvent = (app: ElectronApplication, channel: string, payload: unknown) =>
  app.evaluate(
    ({ BrowserWindow }, [ch, data]) => {
      for (const win of BrowserWindow.getAllWindows()) win.webContents.send(ch as string, data);
    },
    [channel, payload] as const,
  );

test('a new release is announced once, downloads from GitHub, and stays dismissed', async ({
  launchApp,
}) => {
  const { app, page } = await launchApp({
    mockIpc: true,
    env: { STENOAI_E2E_SEED_RELEASE_NOTICE: '1' },
  });
  // Any route inside the app shell; first-run setup has no toast host.
  const openSettings = () =>
    page.evaluate(() => {
      window.location.hash = '#/settings?tab=about';
    });
  await openSettings();

  const pill = page.getByRole('status').filter({ hasText: 'Version 2099.1.1 available' });
  await expect(pill).toBeVisible();

  await pill.getByRole('button', { name: 'Download' }).click();
  await expect.poll(() => releasePages(app)).toEqual([
    'https://github.com/Zaklamp02/StenoAI/releases/download/v2099.1.1/StenoAI-v2099.1.1-arm64.dmg',
  ]);

  await pill.getByRole('button', { name: 'Dismiss new version notice' }).click();
  await expect(pill).toHaveCount(0);
  await expect
    .poll(() =>
      app.evaluate(
        () => (globalThis as unknown as { __dismissedReleaseVersions?: string[] }).__dismissedReleaseVersions ?? [],
      ),
    )
    .toEqual(['2099.1.1']);

  await page.reload();
  await expect(page.locator('[data-app-ready]')).toBeVisible();
  await openSettings();
  await expect(page.locator('[data-settings-tab="about"]')).toBeVisible();
  await expect(page.getByText('Version 2099.1.1 available')).toHaveCount(0);
});

test('Check for Updates finds a newer release and opens its page', async ({ launchApp }) => {
  const { app, page } = await launchApp({
    mockIpc: true,
    env: { STENOAI_E2E_SEED_UPDATE_AVAILABLE: '1' },
  });

  await page.evaluate(() => {
    window.location.hash = '#/settings?tab=about';
  });
  const about = page.locator('[data-settings-tab="about"]');
  await about.getByRole('button', { name: 'Check for Updates' }).click();
  await expect(about.getByText('Update available (v2099.1.1)')).toBeVisible();

  await about.getByRole('button', { name: 'View release' }).click();
  await expect.poll(() => releasePages(app)).toEqual([
    'https://github.com/Zaklamp02/StenoAI/releases/tag/v2099.1.1',
  ]);
});

test('an install that updates itself shows the download, then Restart', async ({ launchApp }) => {
  const { app, page } = await launchApp({
    mockIpc: true,
    env: { STENOAI_E2E_SEED_RELEASE_NOTICE: '1' },
  });
  await page.evaluate(() => {
    window.location.hash = '#/settings?tab=about';
  });
  await expect(page.getByRole('status').filter({ hasText: 'Version 2099.1.1 available' })).toBeVisible();

  await sendUpdaterEvent(app, 'update-available', { version: '2099.1.1' });
  await sendUpdaterEvent(app, 'update-download-progress', { percent: 40 });
  const downloading = page.getByRole('status').filter({ hasText: 'Downloading version 2099.1.1 · 40%' });
  await expect(downloading).toBeVisible();
  // While the updater has it, there is nothing to download by hand.
  await expect(downloading.getByRole('button', { name: 'Download' })).toHaveCount(0);

  // A failed download falls back to the GitHub download.
  await sendUpdaterEvent(app, 'update-error', { message: 'The download failed.' });
  const fallback = page.getByRole('status').filter({ hasText: 'Version 2099.1.1 available' });
  await expect(fallback.getByRole('button', { name: 'Download' })).toBeVisible();

  await sendUpdaterEvent(app, 'update-available', { version: '2099.1.1' });
  await sendUpdaterEvent(app, 'update-download-progress', { percent: 100 });
  await sendUpdaterEvent(app, 'update-downloaded', { version: '2099.1.1' });
  const ready = page.getByRole('status').filter({ hasText: 'Update v2099.1.1 ready' });
  await expect(ready).toBeVisible();
  await ready.getByRole('button', { name: 'Restart' }).click();
  await expect
    .poll(() =>
      app.evaluate(() => (globalThis as unknown as { __installUpdateRequested?: boolean }).__installUpdateRequested ?? false),
    )
    .toBe(true);
});

test('a dismissed download comes back as Download if it fails, and names the version it fetches', async ({
  launchApp,
}) => {
  const { app, page } = await launchApp({
    mockIpc: true,
    env: { STENOAI_E2E_SEED_RELEASE_NOTICE: '1' },
  });
  await page.evaluate(() => {
    window.location.hash = '#/settings?tab=about';
  });
  await expect(page.getByRole('status').filter({ hasText: 'Version 2099.1.1 available' })).toBeVisible();

  // The notice can name a newer pre-release than the full release the updater
  // fetches; the pill names what is actually downloading.
  await sendUpdaterEvent(app, 'update-available', { version: '2099.1.0' });
  await sendUpdaterEvent(app, 'update-download-progress', { percent: 10 });
  const downloading = page.getByRole('status').filter({ hasText: 'Downloading version 2099.1.0 · 10%' });
  await expect(downloading).toBeVisible();

  // Dismissing the download hides it for now and records no dismissal.
  await downloading.getByRole('button', { name: 'Dismiss new version notice' }).click();
  await expect(downloading).toHaveCount(0);
  const dismissed = () =>
    app.evaluate(
      () => (globalThis as unknown as { __dismissedReleaseVersions?: string[] }).__dismissedReleaseVersions ?? [],
    );
  expect(await dismissed()).toEqual([]);

  // A failure brings back the GitHub download for the announced release.
  await sendUpdaterEvent(app, 'update-error', { message: 'The download failed.' });
  const fallback = page.getByRole('status').filter({ hasText: 'Version 2099.1.1 available' });
  await expect(fallback.getByRole('button', { name: 'Download' })).toBeVisible();
});

const downloadRequests = (app: ElectronApplication) =>
  app.evaluate(() => (globalThis as unknown as { __downloadUpdateRequests?: number }).__downloadUpdateRequests ?? 0);

test('with automatic installs off, Update fetches the release in the app, then Restart', async ({ launchApp }) => {
  const { app, page } = await launchApp({
    mockIpc: true,
    env: { STENOAI_E2E_SEED_RELEASE_NOTICE: 'in-app' },
  });
  await page.evaluate(() => {
    window.location.hash = '#/settings?tab=about';
  });
  const pill = page.getByRole('status').filter({ hasText: 'Version 2099.1.1 available' });
  await expect(pill.getByRole('button', { name: 'Update' })).toBeVisible();
  await expect(pill.getByRole('button', { name: 'Download' })).toHaveCount(0);

  // A periodic check that only found the version starts nothing.
  await sendUpdaterEvent(app, 'update-available', { version: '2099.1.1', downloading: false });
  await expect(pill.getByRole('button', { name: 'Update' })).toBeVisible();

  await pill.getByRole('button', { name: 'Update' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Downloading version 2099.1.1 · 0%' })).toBeVisible();
  await expect.poll(() => downloadRequests(app)).toBe(1);
  // Opening the GitHub page is not part of it.
  expect(await releasePages(app)).toEqual([]);

  await sendUpdaterEvent(app, 'update-available', { version: '2099.1.1', downloading: true });
  await sendUpdaterEvent(app, 'update-download-progress', { percent: 60 });
  await expect(page.getByRole('status').filter({ hasText: 'Downloading version 2099.1.1 · 60%' })).toBeVisible();
  await sendUpdaterEvent(app, 'update-downloaded', { version: '2099.1.1' });
  const ready = page.getByRole('status').filter({ hasText: 'Update v2099.1.1 ready' });
  await ready.getByRole('button', { name: 'Restart' }).click();
  await expect
    .poll(() =>
      app.evaluate(() => (globalThis as unknown as { __installUpdateRequested?: boolean }).__installUpdateRequested ?? false),
    )
    .toBe(true);
});

test('an Update that cannot run falls back to the GitHub download', async ({ launchApp }) => {
  const { app, page } = await launchApp({
    mockIpc: true,
    env: { STENOAI_E2E_SEED_RELEASE_NOTICE: 'in-app', STENOAI_E2E_DOWNLOAD_UPDATE_FAILS: '1' },
  });
  await page.evaluate(() => {
    window.location.hash = '#/settings?tab=about';
  });
  const pill = page.getByRole('status').filter({ hasText: 'Version 2099.1.1 available' });
  await pill.getByRole('button', { name: 'Update' }).click();
  await expect(pill.getByRole('button', { name: 'Download' })).toBeVisible();
  await pill.getByRole('button', { name: 'Download' }).click();
  await expect.poll(() => releasePages(app)).toEqual([
    'https://github.com/Zaklamp02/StenoAI/releases/download/v2099.1.1/StenoAI-v2099.1.1-arm64.dmg',
  ]);
});

test('Check for Updates offers Update when the release can be fetched in the app', async ({ launchApp }) => {
  const { app, page } = await launchApp({
    mockIpc: true,
    env: { STENOAI_E2E_SEED_UPDATE_AVAILABLE: 'in-app' },
  });
  await page.evaluate(() => {
    window.location.hash = '#/settings?tab=about';
  });
  const about = page.locator('[data-settings-tab="about"]');
  await about.getByRole('button', { name: 'Check for Updates' }).click();
  await about.getByRole('button', { name: 'Update', exact: true }).click();
  await expect.poll(() => downloadRequests(app)).toBe(1);
  await expect(about.getByText('Downloading update…')).toBeVisible();
});

test('a downloaded update stays dismissed for the session, not offered again', async ({ launchApp }) => {
  const { app, page } = await launchApp({
    mockIpc: true,
    env: { STENOAI_E2E_SEED_RELEASE_NOTICE: 'in-app' },
  });
  await page.evaluate(() => {
    window.location.hash = '#/settings?tab=about';
  });
  await page.getByRole('status').filter({ hasText: 'Version 2099.1.1 available' }).getByRole('button', { name: 'Update' }).click();
  await sendUpdaterEvent(app, 'update-downloaded', { version: '2099.1.1' });
  const ready = page.getByRole('status').filter({ hasText: 'Update v2099.1.1 ready' });
  await ready.getByRole('button', { name: 'Dismiss update notification' }).click();
  await expect(ready).toHaveCount(0);
  // Not back as "available" with an Update button that would stall at 0%.
  await expect(page.getByRole('status')).toHaveCount(0);
});
