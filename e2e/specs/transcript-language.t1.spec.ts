import { test, expect } from '../fixtures/electron';

for (const scenario of [
  { detected: 'fr', setting: 'auto', label: 'Detected language', value: 'French' },
  { detected: 'unknown', setting: 'auto', label: 'Detected language', value: 'Not reported' },
  { detected: 'nl', setting: 'nl', label: 'Reported language', value: 'Dutch' },
]) {
  test(`transcript language: ${scenario.setting}/${scenario.detected}`, async ({ launchApp }, testInfo) => {
    const { page } = await launchApp({ mockIpc: true, env: {
      STENOAI_E2E_SEED_MEETING: '1',
      STENOAI_E2E_TRANSCRIPT_LANGUAGE: scenario.detected,
      STENOAI_E2E_LANGUAGE_SETTING: scenario.setting,
    } });
    await page.evaluate(() => { window.location.hash = '#/meetings/epsilon_summary.json'; });
    await page.getByTestId('transcript-toggle').click();
    const info = page.getByTestId('transcript-language-info');
    await expect(info.locator('summary')).toHaveText(`${scenario.label}: ${scenario.value}`);
    await expect(page.getByPlaceholder('Search transcript')).toBeVisible();
    if (scenario.detected === 'fr') {
      await page.screenshot({ path: testInfo.outputPath('language-collapsed.png') });
    }
    await info.locator('summary').click();
    await expect(info).toContainText('Notes languageDutch');
    await expect(info).toContainText('Language setting');
    await expect(info).toContainText('Re-transcribe recording');
    if (scenario.detected === 'fr') {
      await page.screenshot({ path: testInfo.outputPath('language-expanded.png') });
    }
    if (scenario.detected === 'unknown') {
      await expect(info).toContainText('did not report a detected language');
    }
    if (scenario.setting !== 'auto') {
      await expect(info).toContainText('rather than detect it independently');
    }
  });
}

test('older transcripts show unknown language without borrowing the notes language', async ({ launchApp }) => {
  const { page } = await launchApp({ mockIpc: true, env: { STENOAI_E2E_SEED_MEETING: '1' } });
  await page.evaluate(() => { window.location.hash = '#/meetings/epsilon_summary.json'; });
  await page.getByTestId('transcript-toggle').click();
  await expect(page.getByTestId('transcript-language-info').locator('summary'))
    .toHaveText('Detected language: Not reported');
});
