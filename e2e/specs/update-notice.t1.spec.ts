import type { ElectronApplication } from '@playwright/test';
import { test, expect } from '../fixtures/electron';

/**
 * T1 — mock IPC. The custom build has no in-app installer, so new releases are
 * announced and downloaded from GitHub: the background check's pill (seeded
 * via STENOAI_E2E_SEED_RELEASE_NOTICE) and the About tab's manual check
 * (STENOAI_E2E_SEED_UPDATE_AVAILABLE). See app/e2e-mock-ipc.js.
 */
const releasePages = (app: ElectronApplication) =>
  app.evaluate(() => (globalThis as unknown as { __openedReleasePages?: string[] }).__openedReleasePages ?? []);

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
