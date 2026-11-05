import { test, expect } from '../fixtures/electron';
import { realUserDataDir, fileSig } from '../fixtures/real-user-data';
import { readUserConfig } from '../fixtures/user-config';

/**
 * T2 — the analytics question that opens first-run onboarding, against the
 * real backend. A fresh user-data dir has no config, so /setup opens on the
 * welcome screen before the setup steps. The spec opens /setup itself rather
 * than relying on the no-model redirect, which a dev machine with a cached
 * model never takes. Each answer must land in config.json as a
 * recorded choice (telemetry_consent_given), so it is asked only once.
 */

const WELCOME = '[data-setup-welcome]';

for (const [label, button, enabled] of [
  ['Share usage data', '[data-analytics-accept]', true],
  ['Not now', '[data-analytics-decline]', false],
] as const) {
  test(`fresh install: "${label}" is saved and setup continues`, async ({
    launchApp,
    userDataDir,
  }) => {
    const realDirBefore = fileSig(realUserDataDir());
    const { page } = await launchApp({ askAnalytics: true });
    await page.evaluate(() => {
      window.location.hash = '#/setup';
    });

    await expect(page.locator(WELCOME)).toBeVisible({ timeout: 20_000 });
    await page.locator(button).click();

    await expect
      .poll(() => readUserConfig(userDataDir).telemetry_consent_given, {
        message: 'any answer is recorded as a choice',
      })
      .toBe(true);
    expect(readUserConfig(userDataDir).telemetry_enabled).toBe(enabled);

    await expect(page.locator(WELCOME)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Begin setup' })).toBeVisible();

    // The backend reports the answer, so a re-run of setup skips the question.
    const telemetry = await page.evaluate(() => window.stenoai.settings.getTelemetry());
    expect(telemetry).toMatchObject({ telemetry_enabled: enabled, telemetry_consent_answered: true });

    expect(fileSig(realUserDataDir())).toBe(realDirBefore);
  });
}
