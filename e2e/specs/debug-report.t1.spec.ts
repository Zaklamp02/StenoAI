import { test, expect } from '../fixtures/electron';
import type { Page } from '@playwright/test';

/**
 * T1 — the per-note debug report: the user sees the whole report before
 * anything is sent, sending gives them an ID to quote, and a failed send keeps
 * the report on screen for a retry. The report's contents (content-free by
 * construction) are pinned by tests/test_debug_report.py; that main rebuilds
 * rather than trusts the renderer's copy, by app/debug-report-ipc.test.js.
 */

const SUMMARY_FILE = 'epsilon_summary.json';

async function openReport(page: Page) {
  await page.evaluate((f) => {
    window.location.hash = `#/meetings/${encodeURIComponent(f)}`;
  }, SUMMARY_FILE);
  await expect(page.getByTestId('meeting-detail-title')).toContainText('Epsilon Planning');
  await page.getByRole('button', { name: 'More options' }).click();
  await page.getByRole('button', { name: 'Send debug report…' }).click();
}

test('the report is shown in full before it is sent, then gives an ID', async ({ launchApp }) => {
  const { page } = await launchApp({ mockIpc: true, env: { STENOAI_E2E_SEED_MEETING: '1' } });
  await openReport(page);

  const dialog = page.getByRole('dialog', { name: 'Send a debug report' });
  await expect(dialog.locator('[data-debug-report-preview]')).toContainText('"mic_segments": 12');
  await dialog.getByRole('button', { name: 'Send report' }).click();

  await expect(page.getByRole('dialog', { name: 'Report sent' })).toBeVisible();
  await expect(page.locator('[data-debug-report-id]')).toHaveText('00000000-0000-4000-8000-000000000001');
});

test('cancelling sends nothing', async ({ launchApp }) => {
  const { page } = await launchApp({ mockIpc: true, env: { STENOAI_E2E_SEED_MEETING: '1' } });
  await openReport(page);
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('a failed send keeps the report and allows a retry', async ({ launchApp }) => {
  const { page } = await launchApp({
    mockIpc: true,
    env: { STENOAI_E2E_SEED_MEETING: '1', STENOAI_E2E_DEBUG_REPORT_FAILS: '1' },
  });
  await openReport(page);
  const dialog = page.getByRole('dialog', { name: 'Send a debug report' });
  await dialog.getByRole('button', { name: 'Send report' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Could not send the report');
  await expect(dialog.locator('[data-debug-report-preview]')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Send report' })).toBeEnabled();
});
