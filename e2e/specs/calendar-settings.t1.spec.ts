import { test, expect } from '../fixtures/electron';

/**
 * T1 -- the Calendar group in Settings -> Integrations. StenoAI reads
 * meetings from one source (Apple Calendar wins when it is on), so the group
 * offers sources only while none is connected, and a connected account that
 * Apple Calendar overrides says it is not in use. Connection state comes from
 * the stateful calendar mocks (STENOAI_E2E_CALENDAR_SOURCES); the auth
 * round-trip itself is calendar-auth.t2.
 */

async function openIntegrations(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    window.location.hash = '#/settings?tab=integrations';
  });
  await expect(page.locator('[data-calendar-settings]')).toBeVisible();
}

test('with no calendar connected, every source is offered', async ({ launchApp }) => {
  const { page } = await launchApp({ mockIpc: true });
  await openIntegrations(page);

  await expect(page.getByText('Connect a calendar')).toBeVisible();
  const group = page.locator('[data-calendar-settings]');
  await expect(group.getByRole('button', { name: 'Outlook' })).toBeVisible();
  await expect(group.getByRole('button', { name: 'Google' })).toBeVisible();
  await expect(group.getByRole('button', { name: 'Apple Calendar' })).toBeVisible();
});

test('an account Apple Calendar overrides says so, and disconnecting Apple puts it in use', async ({ launchApp }) => {
  const { page } = await launchApp({
    mockIpc: true,
    env: { STENOAI_E2E_CALENDAR_SOURCES: 'apple,outlook' },
  });
  await openIntegrations(page);

  const group = page.locator('[data-calendar-settings]');
  await expect(group.getByText('Connected. Uses every calendar in Calendar.app.')).toBeVisible();
  await expect(
    group.getByText('Connected, but not used while Apple Calendar is connected.'),
  ).toBeVisible();
  // Connected sources are only disconnected here, never stacked on.
  await expect(group.getByRole('button', { name: 'Google' })).toHaveCount(0);

  await group.getByRole('button', { name: 'Disconnect' }).first().click();

  await expect(group.getByText('Connected as owner@example.com')).toBeVisible();
  await expect(group.getByRole('button', { name: 'Disconnect' })).toHaveCount(1);
});

test('the Preferences tab no longer carries the calendar', async ({ launchApp }) => {
  const { page } = await launchApp({ mockIpc: true });
  await page.evaluate(() => {
    window.location.hash = '#/settings?tab=general';
  });
  await expect(page.getByText('Meeting notifications', { exact: true })).toBeVisible();
  await expect(page.locator('[data-calendar-settings]')).toHaveCount(0);
});
