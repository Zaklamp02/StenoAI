import { test, expect } from '../fixtures/electron';
import { readUserConfig, writeUserConfig } from '../fixtures/user-config';

/**
 * T2 — endpoints that receive meeting text or credentials must be encrypted
 * unless they are this machine (security review F06). Drives the real
 * setters through the preload bridge and asserts config.json on disk.
 */

test('an http address on another machine is refused and the saved one kept', async ({
  launchApp,
  userDataDir,
}) => {
  writeUserConfig(userDataDir, { cloud_api_url: 'https://api.example.test/v1' });
  const { page } = await launchApp();

  const refused = await page.evaluate(() => window.stenoai.ai.setCloudApiUrl('http://10.0.0.5/v1'));
  expect(refused).toMatchObject({ success: false });
  expect(String((refused as { error?: string }).error)).toContain('https');
  expect(readUserConfig(userDataDir).cloud_api_url).toBe('https://api.example.test/v1');

  const withCredentials = await page.evaluate(
    () => window.stenoai.ai.setCloudApiUrl('https://user:secret@api.example.test/v1'),
  );
  expect(withCredentials).toMatchObject({ success: false });

  const remote = await page.evaluate(() => window.stenoai.ai.setRemoteOllamaUrl('http://192.168.1.20:11434'));
  expect(remote).toMatchObject({ success: false });
});

test('https anywhere and http to this machine are saved', async ({ launchApp, userDataDir }) => {
  const { page } = await launchApp();
  await page.evaluate(() => window.stenoai.ai.setCloudApiUrl('https://api.example.test/v1/'));
  await expect.poll(() => readUserConfig(userDataDir).cloud_api_url).toBe('https://api.example.test/v1');
  await page.evaluate(() => window.stenoai.ai.setRemoteOllamaUrl('http://localhost:11434'));
  await expect.poll(() => readUserConfig(userDataDir).remote_ollama_url).toBe('http://localhost:11434');
});

test('organisation sign-in refuses a plain-http adapter before sending the password', async ({ launchApp }) => {
  const { page } = await launchApp();
  const result = await page.evaluate(() => window.stenoai.org.login(
    'http://org.example.invalid:8000', 'someone@example.test', 'not-a-real-password',
  ));
  expect(result).toMatchObject({ success: false });
  expect(String((result as { error?: string }).error)).toContain('https');
});
