import { test, expect } from '../fixtures/electron';
import { enableSpeakerIdentification, writeUserConfig, writeMeetingMarkdown, writeSpeakersSidecar, writeTranscriptFile, fixtureDiarizationRunId } from '../fixtures/user-config';
import { mkdirSync, readFileSync, writeFileSync, readdirSync, appendFileSync, renameSync, utimesSync } from 'node:fs';
import path from 'node:path';

// Model-free: real IPC approvals, persisted profiles/sidecar, and standalone
// app-managed sync into an isolated vault. Uses the packaged CLI's ranking API.
test('Obsidian exports tentative and confirmed identities separately and follows later edits', async ({ launchApp, userDataDir }) => {
  test.setTimeout(90_000);
  const stem = 'vault-speaker-context';
  const basis = (index: number) => Array.from({ length: 256 }, (_, i) => i === index ? 1 : 0);
  enableSpeakerIdentification(userDataDir);
  writeUserConfig(userDataDir, { person_profiles: [{ person_id: 'alex-fixture', display_name: 'Alex Fixture',
    prototypes: ['history-one', 'history-two'].map(meeting_id => ({ meeting_id, recording_type: 'in_person', embedding_mean: basis(0) })),
    hard_negatives: [],
  }] });
  const body = '[00:01] [Speaker 1] Substantial contribution.\n\n[00:30] [Speaker 2] Yes.';
  const summary = writeMeetingMarkdown(userDataDir, stem, { name: 'Speaker context fixture',
    summaryMarkdown: '## Summary\nAvailable generated summary.', transcript: body, frontmatter: { is_diarised: true } });
  writeTranscriptFile(userDataDir, stem, body);
  writeSpeakersSidecar(userDataDir, stem, { mic: { recording_type: 'in_person', clusters: {
    SPEAKER_0: { embedding: basis(0), speech_duration_seconds: 30, segment_count: 5, segments: [{ start: 1.2, end: 29 }] },
    SPEAKER_1: { embedding: basis(1), speech_duration_seconds: .8, segment_count: 1, segments: [{ start: 30, end: 30.8 }] },
  } } }, [
    { start: 1.2, channel: 'mic', diarization_speaker_id: 'SPEAKER_0' },
    { start: 30, channel: 'mic', diarization_speaker_id: 'SPEAKER_1' },
  ]);
  const calendar = path.join(userDataDir, 'output', stem + '_calendar.json');
  const writeCalendar = (name: string) => writeFileSync(calendar, JSON.stringify({ event: {
    title: 'Calendar meeting', attendees: [{ name, email: 'invited@example.test', status: 'accepted' },
      { name: 'Owner', email: 'owner@example.test', self: true, status: 'accepted' }],
  } }));
  writeCalendar('Invited Fixture');
  const vault = path.join(userDataDir, 'vault');
  const syncDir = path.join(userDataDir, 'sync');
  mkdirSync(vault); mkdirSync(syncDir);
  const backend = process.env.STENOAI_E2E_APP_PATH
    ? path.resolve(process.env.STENOAI_E2E_APP_PATH, '..', '..', 'Resources', 'stenoai', 'stenoai')
    : path.resolve('..', 'dist', 'stenoai', process.platform === 'win32' ? 'stenoai.exe' : 'stenoai');
  writeFileSync(path.join(syncDir, 'config.json'), JSON.stringify({ vault, steno_backend: backend,
    settle_seconds: 0, link_from_daily_notes: false }));
  const sync = async () => {
    const result = await page.evaluate(() => window.stenoai.settings.retryObsidianSync());
    expect(result.success, JSON.stringify(result)).toBe(true);
    const state = JSON.parse(readFileSync(path.join(syncDir, 'state.json'), 'utf8'));
    expect(state.errors).toEqual({});
  };
  const data = (file: string) => JSON.parse(readFileSync(file, 'utf8').match(/### Structured speaker data\n\n```json\n([\s\S]*?)\n```/)![1]);
  const { page } = await launchApp({ env: { STENOAI_SYNC_CONFIG_DIR: syncDir } });
  await page.evaluate(async vault => { await window.stenoai.settings.setObsidianVaultPath(vault); await window.stenoai.settings.setObsidianSync(true); }, vault);
  const suggestions = await page.evaluate(s => window.stenoai.speakers.suggestForMeeting(s), stem);
  expect(suggestions.success).toBe(true);
  await sync();
  const trDir = path.join(vault, 'StenoAI', 'Transcripts');
  let transcript = path.join(trDir, readdirSync(trDir)[0]);
  let context = data(transcript);
  expect(context.speakers).toHaveLength(2);
  expect(context.speakers[0]).toMatchObject({ review_status: 'unconfirmed', suggested_name: 'Alex Fixture',
    confirmed_name: null, suggestion_strength: 'likely', transcript_turns: [1], transcript_labels: ['Speaker 1'] });
  expect(context.speakers[1]).toMatchObject({ hidden_in_app: true, review_status: 'unidentified', transcript_turns: [2] });
  expect(context.calendar_invitees).toHaveLength(2);
  expect(readFileSync(transcript, 'utf8')).toContain('[Speaker 1] Substantial contribution.');
  expect(readFileSync(transcript, 'utf8')).not.toContain('embedding');
  const archive = path.join(vault, 'Archive', 'StenoAI', 'Transcripts');
  mkdirSync(archive, { recursive: true });
  const archived = path.join(archive, 'renamed-by-user.md');
  renameSync(transcript, archived); transcript = archived;
  appendFileSync(transcript, '\nVault-only annotation.\n');
  const approved = await page.evaluate(params => window.stenoai.speakers.confirm(params), {
    meetingStem: stem, channel: 'mic', diarizationSpeakerId: 'SPEAKER_0',
    expectedRunId: fixtureDiarizationRunId(stem), personId: 'alex-fixture', summaryFile: summary,
  });
  expect(approved.success, JSON.stringify(approved)).toBe(true);
  await sync();
  context = data(transcript);
  expect(context.speakers[0]).toMatchObject({ review_status: 'confirmed', confirmed_name: 'Alex Fixture', confirmed_person_id: 'alex-fixture' });
  expect(readFileSync(transcript, 'utf8')).toContain('Vault-only annotation.');
  expect(readFileSync(transcript, 'utf8')).toContain('[Alex Fixture] Substantial contribution.');
  // A profile-only change invalidates even an old meeting's export.
  const old = new Date(0);
  for (const file of [summary, calendar, path.join(userDataDir, 'output', stem + '_speakers.json'),
    path.join(userDataDir, 'transcripts', stem + '_transcript.txt')]) utimesSync(file, old, old);
  const renamed = await page.evaluate(() => window.stenoai.speakers.renameProfile('alex-fixture', 'Alex Renamed'));
  expect(renamed.success).toBe(true);
  await sync();
  expect(data(transcript).speakers[0].confirmed_name).toBe('Alex Renamed');
  writeCalendar('New Invitee');
  await sync();
  expect(data(transcript).calendar_invitees[0].name).toBe('New Invitee');
  expect(readFileSync(transcript, 'utf8')).toContain('attendees: ["New Invitee", "Owner"]');
  expect(readdirSync(trDir)).toHaveLength(0);
});
