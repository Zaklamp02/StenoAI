import { test, expect } from '../fixtures/electron';
import { readUserConfig } from '../fixtures/user-config';

/**
 * T2 — "Install updates automatically" off means "ask first": main reads
 * auto_install_when_idle from config.json before every update check or
 * download (update-mode.js). Under E2E the updater never starts, so the real
 * download-update handler answers that this install cannot update itself
 * instead of touching the network; the pill then falls back to Download
 * (its UI half is update-notice.t1).
 */
test('ask first persists, and Update on a non-updating install fails safely', async ({ launchApp, userDataDir }) => {
  const { page } = await launchApp({ releaseHighlightsSeen: true });

  const off = await page.evaluate(() => window.stenoai.settings.setAutoInstallWhenIdle(false));
  expect(off.success).toBe(true);
  expect(readUserConfig(userDataDir).auto_install_when_idle).toBe(false);

  const download = await page.evaluate(() => window.stenoai.updates.download());
  expect(download).toEqual({ success: false, error: 'This install cannot update itself.' });

  const status = await page.evaluate(() => window.stenoai.updates.getStatus());
  expect(status).toMatchObject({ success: true, downloadedVersion: null, downloadPercent: null });
});
