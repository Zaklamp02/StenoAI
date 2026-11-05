import { test, expect } from '../fixtures/electron';

/**
 * T1 — first-run onboarding around the setup steps: the analytics question
 * that opens it, and the short tour that closes it. Mock IPC keeps it
 * hermetic; the persisted answer itself is asserted on disk by
 * onboarding-consent.t2.
 */

const FRESH = {
  STENOAI_E2E_TELEMETRY_UNANSWERED: '1',
  STENOAI_E2E_MOCK_PARAKEET_INSTALLED: '1',
  STENOAI_E2E_SPEAKER_MODELS_MISSING: '1',
  STENOAI_E2E_RENDERER_PLATFORM: 'darwin',
};

async function openSetup(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    window.location.hash = '#/setup';
  });
}

test('a fresh install is asked about analytics before the setup steps', async ({ launchApp }) => {
  const { page } = await launchApp({ mockIpc: true, env: FRESH });
  await openSetup(page);

  await expect(page.locator('[data-setup-welcome]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Begin setup' })).toHaveCount(0);
  // Both answers are offered; sharing is the primary one but nothing is
  // chosen until the user clicks.
  await expect(page.getByRole('button', { name: 'Not now' })).toBeVisible();
  await page.getByRole('button', { name: 'Share usage data' }).click();

  await expect(page.locator('[data-setup-welcome]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Begin setup' })).toBeVisible();
  const telemetry = await page.evaluate(() => window.stenoai.settings.getTelemetry());
  expect(telemetry).toMatchObject({ telemetry_enabled: true, telemetry_consent_answered: true });
});

test('"Not now" records a no and moves on to setup', async ({ launchApp }) => {
  const { page } = await launchApp({ mockIpc: true, env: FRESH });
  await openSetup(page);

  await page.getByRole('button', { name: 'Not now' }).click();
  await expect(page.getByRole('button', { name: 'Begin setup' })).toBeVisible();
  const telemetry = await page.evaluate(() => window.stenoai.settings.getTelemetry());
  expect(telemetry).toMatchObject({ telemetry_enabled: false, telemetry_consent_answered: true });
});

test('an install that already answered goes straight to the setup steps', async ({ launchApp }) => {
  const { page } = await launchApp({
    mockIpc: true,
    env: { ...FRESH, STENOAI_E2E_TELEMETRY_UNANSWERED: '0' },
  });
  await openSetup(page);
  await expect(page.getByRole('button', { name: 'Begin setup' })).toBeVisible();
  await expect(page.locator('[data-setup-welcome]')).toHaveCount(0);
});

test('finishing setup walks a short tour and lands on Home', async ({ launchApp }) => {
  const { page } = await launchApp({
    mockIpc: true,
    env: { ...FRESH, STENOAI_E2E_TELEMETRY_UNANSWERED: '0' },
  });
  await openSetup(page);
  await page.getByRole('button', { name: 'Begin setup' }).click();
  await page.getByRole('button', { name: 'Continue to app' }).click();

  const tour = page.locator('[data-onboarding-tour]');
  await expect(tour.locator('[data-onboarding-slide="record"]')).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(tour.locator('[data-onboarding-slide="calendar"]')).toBeVisible();
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(tour.locator('[data-onboarding-slide="record"]')).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(tour.locator('[data-onboarding-slide="ask"]')).toBeVisible();
  await page.getByRole('button', { name: 'Start using Steno' }).click();

  await expect(tour).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#/');
});

test('the calendar slide opens Settings -> Integrations', async ({ launchApp }) => {
  const { page } = await launchApp({
    mockIpc: true,
    env: { ...FRESH, STENOAI_E2E_TELEMETRY_UNANSWERED: '0' },
  });
  await openSetup(page);
  await page.getByRole('button', { name: 'Begin setup' }).click();
  await page.getByRole('button', { name: 'Continue to app' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Open Integrations' }).click();

  await expect
    .poll(() => page.evaluate(() => location.hash))
    .toBe('#/settings?tab=integrations');
});
