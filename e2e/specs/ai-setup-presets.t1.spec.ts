import { test, expect } from '../fixtures/electron';

/**
 * T1 -- the AI tab's Setup presets. A preset is a data flow (what leaves the
 * computer), so the selected card and the "where your data goes" lines must
 * follow the engine + provider below, and picking a preset must set both.
 * Best quality uploads audio, so it keeps the cloud-ASR confirmation.
 */

async function openAiSettings(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    window.location.hash = '#/settings?tab=ai';
  });
  await expect(page.getByTestId('ai-setup-presets')).toBeVisible();
}

const preset = (page: import('@playwright/test').Page, id: string) =>
  page.locator(`[role="radio"][data-preset="${id}"]`);

test('presets follow and set the engine and provider', async ({ launchApp }) => {
  const { page } = await launchApp({ mockIpc: true });
  await openAiSettings(page);
  const flow = page.getByTestId('ai-data-flow');

  // Mock defaults: Parakeet + local Ollama.
  await expect(preset(page, 'private')).toHaveAttribute('aria-checked', 'true');
  await expect(flow).toContainText('Audio stays on this computer');
  await expect(flow).toContainText('Transcripts stay on this computer');

  await preset(page, 'balanced').click();
  await expect(preset(page, 'balanced')).toHaveAttribute('aria-checked', 'true');
  await expect(flow).toContainText('Audio stays on this computer');
  await expect(flow).toContainText('Transcripts are sent to OpenAI');
  await expect(page.getByTestId('ai-provider-select')).toContainText('Cloud API');

  // Best quality asks before audio leaves the computer; cancelling changes nothing.
  await preset(page, 'best').click();
  const dialog = page.locator('[data-confirm-dialog]');
  await expect(dialog).toContainText('Send audio to a cloud service?');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(preset(page, 'balanced')).toHaveAttribute('aria-checked', 'true');

  await preset(page, 'best').click();
  await dialog.getByRole('button', { name: 'Use cloud ASR' }).click();
  await expect(preset(page, 'best')).toHaveAttribute('aria-checked', 'true');
  await expect(flow).toContainText('Audio is sent to api.openai.com');
  await expect(page.getByTestId('openai-asr-config')).toBeVisible();

  // Back to Private leaves the cloud engine for the installed on-device one.
  await preset(page, 'private').click();
  await expect(preset(page, 'private')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('transcription-model-select')).toContainText('Parakeet');
  await expect(page.getByTestId('openai-asr-config')).toHaveCount(0);
});

test('a combination outside the presets reads as Custom', async ({ launchApp }) => {
  const { page } = await launchApp({ mockIpc: true });
  await openAiSettings(page);

  await page.getByTestId('ai-provider-select').click();
  await page.getByRole('option', { name: /private server/i }).click();
  await expect(page.getByTestId('ai-preset-custom')).toBeVisible();
  await expect(page.locator('[role="radio"][aria-checked="true"]')).toHaveCount(0);
  await expect(page.getByTestId('ai-data-flow')).toContainText('your own Ollama server');
});

test('a small local notes model gets a warning; the stages are in pipeline order', async ({ launchApp }) => {
  const { page } = await launchApp({ mockIpc: true });
  await openAiSettings(page);

  // The mock's current model is gemma4:e2b (2B).
  await expect(page.getByTestId('small-model-note')).toContainText('4B or larger');

  const section = page.locator('[data-settings-tab="ai"]');
  const text = await section.innerText();
  const order = ['Setup', 'Speech to text', 'Notes & chat'].map((h) => text.indexOf(h));
  expect(order.every((i) => i >= 0)).toBe(true);
  expect(order).toEqual([...order].sort((a, b) => a - b));
  // Storage moved to Preferences.
  await expect(section).not.toContainText('Save recordings');
});
