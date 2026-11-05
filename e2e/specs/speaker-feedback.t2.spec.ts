import { test, expect } from '../fixtures/electron';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { writeUserConfig, readUserConfig } from '../fixtures/user-config';

/**
 * T2 — speaker-review feedback through the real backend. Confirming a speaker
 * keeps one content-free record in speaker_feedback.jsonl (always, it is the
 * user's own accuracy log) and the renderer's reply carries none of it. The
 * second opt-in for sending it persists like any other setting. What may be
 * sent is pinned by speakerFeedbackProperties' unit tests.
 */

function seedSidecar(userDataDir: string) {
  const output = path.join(userDataDir, 'output');
  mkdirSync(output, { recursive: true });
  const cluster = (embedding: number[]) => ({
    embedding, speech_duration_seconds: 30, segment_count: 5,
    segments: [{ start: 0, end: 30 }],
  });
  writeFileSync(path.join(output, 'mtgA_speakers.json'), JSON.stringify({
    meeting_id: 'mtgA',
    created_at: 0,
    diarization_run: { run_id: 'run-a', created_at: 0 },
    channels: {
      mic: { recording_type: 'in_person', clusters: { SPEAKER_00: cluster([1, 0]), SPEAKER_01: cluster([0, 1]) } },
    },
  }));
}

test('a confirm keeps a feedback record locally and none of it reaches the renderer', async ({
  launchApp,
  userDataDir,
}) => {
  writeUserConfig(userDataDir, {
    identity_matching_enabled: true, identity_matching_privacy_default_version: 1,
  });
  seedSidecar(userDataDir);
  const { page } = await launchApp();

  const suggestions = await page.evaluate(() => window.stenoai.speakers.suggestForMeeting('mtgA'));
  const runId = (suggestions as { diarization_run_id?: string }).diarization_run_id;
  expect(runId, 'suggest-speakers read the seeded sidecar').toBeTruthy();

  const result = await page.evaluate((expectedRunId) => window.stenoai.speakers.confirm({
    meetingStem: 'mtgA', channel: 'mic', diarizationSpeakerId: 'SPEAKER_00',
    expectedRunId, newPersonName: 'Person Alpha',
  }), runId as string);
  expect(result).toMatchObject({ success: true });
  expect(result).not.toHaveProperty('feedback');

  const log = path.join(userDataDir, 'speaker_feedback.jsonl');
  await expect.poll(() => existsSync(log)).toBe(true);
  const rows = readFileSync(log, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ action: 'new_person', channel: 'mic', chosen_rank: 'new_person' });
  expect(JSON.stringify(rows[0])).not.toContain('Person Alpha');

  const summary = await page.evaluate(() => window.stenoai.settings.getSpeakerFeedbackSummary());
  expect(summary).toMatchObject({ success: true, named_without_suggestion: 1 });
});

test('the speaker feedback opt-in persists to config.json', async ({ launchApp, userDataDir }) => {
  const { page } = await launchApp();
  await page.evaluate(() => window.stenoai.settings.setSpeakerFeedbackSharing(true));
  await expect.poll(() => readUserConfig(userDataDir).speaker_feedback_sharing).toBe(true);
  const telemetry = await page.evaluate(() => window.stenoai.settings.getTelemetry());
  expect(telemetry).toMatchObject({ speaker_feedback_sharing: true });

  await page.evaluate(() => window.stenoai.settings.setSpeakerFeedbackSharing(false));
  await expect.poll(() => readUserConfig(userDataDir).speaker_feedback_sharing).toBe(false);
});
