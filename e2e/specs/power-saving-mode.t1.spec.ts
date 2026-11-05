import { test, expect } from '../fixtures/electron';

/**
 * T1 — Settings → AI → Power saving mode is the on/off face of
 * processing_power_policy: on = 'plugged_in', off = 'always'. The held-queue
 * behaviour itself is covered by processing-power.t2.
 */

test('the power saving switch maps to the processing power policy', async ({ launchApp }) => {
  const { page } = await launchApp({ mockIpc: true });
  await page.evaluate(() => {
    window.location.hash = '#/settings?tab=ai';
  });

  const toggle = page.getByRole('switch', { name: 'Power saving mode' });
  await expect(toggle).toHaveAttribute('aria-checked', 'false');

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await expect
    .poll(() => page.evaluate(() => window.stenoai.settings.getProcessingPowerPolicy()))
    .toMatchObject({ processing_power_policy: 'plugged_in' });

  await toggle.click();
  await expect
    .poll(() => page.evaluate(() => window.stenoai.settings.getProcessingPowerPolicy()))
    .toMatchObject({ processing_power_policy: 'always' });
});
