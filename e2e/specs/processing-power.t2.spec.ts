import { test, expect } from '../fixtures/electron';
import { mkdirSync, readFileSync, existsSync } from 'fs';
import path from 'path';
import { makeWav } from '../fixtures/make-wav';
import { readUserConfig, writeUserConfig } from '../fixtures/user-config';

/**
 * T2 — Settings → Power saving mode (`processing_power_policy`). With
 * power saving mode on (plugged_in) on battery, a queued meeting is held (journaled as
 * `waiting-power`), survives a quit, comes back on relaunch without a recovery
 * prompt, and runs on "Process now"; the live transcript is skipped too.
 *
 * The battery is simulated with STENOAI_E2E_POWER_SOURCE (honoured only under
 * STENOAI_E2E). Model-free: the held job never reaches a model, and the one
 * that is released is a silent WAV, as in recording-recovery.t2.
 */

const BATTERY = { STENOAI_E2E_POWER_SOURCE: 'battery' };

function seed(userDataDir: string, policy: 'always' | 'plugged_in') {
  writeUserConfig(userDataDir, {
    telemetry_enabled: false, privacy_notice_seen: true,
    auto_detect_meetings_enabled: false, launch_on_login: false,
    keep_recordings: true, auto_summarize_enabled: false,
    transcription_engine: 'whisper', ai_provider: 'cloud',
    identity_matching_enabled: false, identity_matching_privacy_default_version: 1,
    processing_power_policy: policy,
  });
  mkdirSync(path.join(userDataDir, 'recordings'), { recursive: true });
  mkdirSync(path.join(userDataDir, 'output'), { recursive: true });
}

function journalStates(userDataDir: string): string[] {
  const file = path.join(userDataDir, 'recording-journal.json');
  if (!existsSync(file)) return [];
  const data = JSON.parse(readFileSync(file, 'utf8')) as { entries: Record<string, { state: string }> };
  return Object.values(data.entries).map((e) => e.state);
}

test('the processing power policy round-trips and rejects unknown values', async ({ launchApp, userDataDir }) => {
  seed(userDataDir, 'always');
  const { page } = await launchApp({ releaseHighlightsSeen: true, env: BATTERY });

  const initial = await page.evaluate(() => window.stenoai.settings.getProcessingPowerPolicy());
  expect(initial).toMatchObject({ success: true, processing_power_policy: 'always', on_battery: true });

  const set = await page.evaluate(() => window.stenoai.settings.setProcessingPowerPolicy('plugged_in'));
  expect(set.success).toBe(true);
  expect(readUserConfig(userDataDir).processing_power_policy).toBe('plugged_in');

  const bad = await page.evaluate(() =>
    window.stenoai.settings.setProcessingPowerPolicy('sometimes' as 'always'));
  expect(bad.success).toBe(false);
  expect(readUserConfig(userDataDir).processing_power_policy).toBe('plugged_in');
});

test('on battery a meeting waits for power, survives a restart, and runs on Process now', async ({ launchApp, userDataDir }) => {
  test.setTimeout(120_000);
  seed(userDataDir, 'plugged_in');
  const srcDir = path.join(userDataDir, 'import-src');
  mkdirSync(srcDir, { recursive: true });
  const src = path.join(srcDir, 'battery-meeting.wav');
  makeWav(src, { seconds: 2, channels: 2, amplitude: 0 });

  const first = await launchApp({ releaseHighlightsSeen: true, env: BATTERY });
  const queued = await first.page.evaluate((file) => window.stenoai.recording.processFile(file, 'Battery meeting'), src);
  expect(queued.success).toBe(true);
  await expect.poll(() => first.page.evaluate(() => window.stenoai.recording.getQueue()))
    .toMatchObject({ waitingForPower: true, queueSize: 1, isProcessing: false });
  expect(journalStates(userDataDir)).toEqual(['waiting-power']);
  await expect(first.page.getByTestId('power-wait-notice')).toBeVisible();

  // Quitting must not prompt: the held meeting is journaled, nothing is lost.
  await first.app.close();

  const second = await launchApp({ releaseHighlightsSeen: true, env: BATTERY });
  await expect.poll(() => second.page.evaluate(() => window.stenoai.recording.getQueue()))
    .toMatchObject({ waitingForPower: true, queueSize: 1 });
  const recoverable = await second.page.evaluate(() => window.stenoai.recording.recoverable());
  expect(recoverable.success && recoverable.recordings).toEqual([]);

  const notice = second.page.getByTestId('power-wait-notice');
  await expect(notice).toBeVisible();
  await notice.getByRole('button', { name: 'Process now' }).click();
  await expect.poll(() => second.page.evaluate(() => window.stenoai.recording.getQueue()), { timeout: 90_000 })
    .toMatchObject({ waitingForPower: false, queueSize: 0, isProcessing: false });
  await expect.poll(() => journalStates(userDataDir)[0], { timeout: 10_000 }).toMatch(/^(complete|failed)$/);
  await expect(notice).toBeHidden();
});

test('switching to Always releases meetings held for power', async ({ launchApp, userDataDir }) => {
  test.setTimeout(120_000);
  seed(userDataDir, 'plugged_in');
  const src = path.join(userDataDir, 'release.wav');
  makeWav(src, { seconds: 2, channels: 2, amplitude: 0 });

  const { page } = await launchApp({ releaseHighlightsSeen: true, env: BATTERY });
  expect((await page.evaluate((file) => window.stenoai.recording.processFile(file, 'Held'), src)).success).toBe(true);
  await expect.poll(() => page.evaluate(() => window.stenoai.recording.getQueue()))
    .toMatchObject({ waitingForPower: true, queueSize: 1 });

  expect((await page.evaluate(() => window.stenoai.settings.setProcessingPowerPolicy('always'))).success).toBe(true);
  await expect.poll(() => page.evaluate(() => window.stenoai.recording.getQueue()), { timeout: 90_000 })
    .toMatchObject({ waitingForPower: false, queueSize: 0, isProcessing: false });
});

test('on battery the live transcript is skipped', async ({ launchApp, userDataDir }) => {
  seed(userDataDir, 'plugged_in');
  // Parakeet would normally spawn the live sidecar; on battery it must not.
  writeUserConfig(userDataDir, { system_audio_enabled: true, transcription_engine: 'parakeet' });
  const { page } = await launchApp({ releaseHighlightsSeen: true, env: BATTERY });
  const support = await page.evaluate(() => window.stenoai.recording.getSystemAudioSupport());
  if (!support?.supported) {
    // eslint-disable-next-line no-console
    console.warn('[t2] SKIPPED live-on-battery: system-audio (renderer-driven) path unsupported on this host.');
  }
  test.skip(!support?.supported, 'system-audio path unsupported on this runner');

  expect((await page.evaluate(() => window.stenoai.recording.start('Battery live'))).success).toBe(true);
  await expect.poll(() => page.evaluate(() => window.stenoai.liveTranscript.getState()))
    .toMatchObject({ sessionName: 'Battery live', waitingForPower: true, ready: false });
  await page.getByRole('button', { name: 'Show transcript' }).first().click();
  await expect(page.getByText('Live transcript off on battery')).toBeVisible();
  await page.evaluate(() => window.stenoai.recording.stop());
});
