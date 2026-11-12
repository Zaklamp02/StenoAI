import { test, expect } from '../fixtures/electron';

/**
 * T1 — mock IPC. Settings -> General shows what kept recordings use and opens
 * their folder. STENOAI_E2E_SEED_SAVED_RECORDINGS=1 reports three recordings
 * while saving is off (the mock default), so the summary row is shown on its
 * own: earlier recordings are still on disk. See app/e2e-mock-ipc.js.
 */
test('Saved recordings shows count, size and age, and opens the folder', async ({ launchApp }) => {
  const launched = await launchApp({
    mockIpc: true,
    env: { STENOAI_E2E_SEED_SAVED_RECORDINGS: '1' },
  });
  await launched.page.evaluate(() => {
    window.location.hash = '#/settings?tab=general';
  });

  const summary = launched.page.getByText(/^3 recordings, 1\.5 GB, oldest from /);
  await expect(summary).toBeVisible();
  await expect(launched.page.getByText('Saved recordings', { exact: true })).toBeVisible();

  await launched.page.getByTestId('open-recordings-folder').click();
  await expect
    .poll(() =>
      launched.app.evaluate(
        () => (globalThis as unknown as { __openedRecordingsFolder?: boolean }).__openedRecordingsFolder ?? false,
      ),
    )
    .toBe(true);
});
