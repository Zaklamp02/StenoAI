import { test, expect } from '../fixtures/electron';
import { startMockAdapter } from '../fixtures/mock-adapter';
import { readUserConfig } from '../fixtures/user-config';

/**
 * T2 — what happens to AI processing when an organisation session ends
 * (security review F10). A user who had a personal cloud provider before
 * signing in must not have their meetings silently sent there when the
 * session is revoked or expires: processing falls back to this Mac. Signing
 * out deliberately still restores their previous choice.
 */

async function signInFromCloud(launchApp: Parameters<Parameters<typeof test>[1]>[0]['launchApp']) {
  const adapter = await startMockAdapter();
  const { app, page } = await launchApp();
  const encryptionAvailable = await app.evaluate(({ safeStorage }) => safeStorage.isEncryptionAvailable());
  test.skip(!encryptionAvailable, 'safeStorage unavailable on this runner');

  await page.evaluate(() => window.stenoai.ai.setProvider('cloud'));
  const login = await page.evaluate(
    (url) => window.stenoai.org.login(url, 'e2e@example.com', 'hunter2'),
    adapter.url,
  );
  expect(login).toMatchObject({ success: true });
  return { adapter, page };
}

test('a revoked session falls back to this Mac, not the personal cloud provider', async ({
  launchApp,
  userDataDir,
}) => {
  const { adapter, page } = await signInFromCloud(launchApp);
  try {
    await expect.poll(() => readUserConfig(userDataDir).ai_provider, { timeout: 15_000 }).toBe('adapter');

    adapter.setRevoked(true);
    const listed = await page.evaluate(() => window.stenoai.org.listMeetings());
    expect(listed).toMatchObject({ success: false });

    await expect.poll(() => readUserConfig(userDataDir).ai_provider, { timeout: 15_000 }).toBe('local');
    expect(await page.evaluate(() => window.stenoai.org.status())).toMatchObject({ signedIn: false });
  } finally {
    await adapter.close();
  }
});

test('signing out yourself restores the provider you had before', async ({ launchApp, userDataDir }) => {
  const { adapter, page } = await signInFromCloud(launchApp);
  try {
    await expect.poll(() => readUserConfig(userDataDir).ai_provider, { timeout: 15_000 }).toBe('adapter');
    await page.evaluate(() => window.stenoai.org.logout());
    await expect.poll(() => readUserConfig(userDataDir).ai_provider, { timeout: 15_000 }).toBe('cloud');
  } finally {
    await adapter.close();
  }
});
