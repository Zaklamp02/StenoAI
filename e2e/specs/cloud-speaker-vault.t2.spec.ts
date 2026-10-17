import { test, expect } from '../fixtures/electron';
import { enableSpeakerIdentification, writeUserConfig } from '../fixtures/user-config';
import { makeWav } from '../fixtures/make-wav';
import { fileSig, realUserDataDir } from '../fixtures/real-user-data';
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

// Model-free real backend: synthetic audio, local HTTP ASR, fixture acoustic
// boundaries. No real credentials, model weights, cloud requests or vault writes.
test('recommended cloud transcription retains speaker provenance and manual naming refreshes the vault', async ({ launchApp, userDataDir }) => {
  test.skip(process.platform !== 'darwin', 'Acoustic speaker sidecar is macOS-only');
  test.setTimeout(120_000);
  const realBefore = fileSig(realUserDataDir());
  const requests: Array<{ auth?: string; body: string }> = [];
  const words = ['alpha', 'bravo', 'charlie', 'delta'];
  let primaryCalls = 0;
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', chunk => chunks.push(Buffer.from(chunk)));
    request.on('end', () => {
      const body = Buffer.concat(chunks).toString('latin1');
      const confirmation = body.includes('\r\n\r\ngpt-4o-transcribe-diarize\r\n');
      requests.push({ auth: request.headers.authorization, body });
      response.writeHead(200, { 'Content-Type': 'application/json' });
      if (confirmation) {
        response.end(JSON.stringify({ text: 'alpha', language: 'nl', segments: [{ start: 0, end: 8, text: 'alpha' }] }));
      } else {
        const index = primaryCalls++;
        // Real meetings include short turns returning empty JSON. Prove that
        // independent recovery preserves their original speaker provenance.
        response.end(JSON.stringify({ text: index === 0 ? '' : words[index % words.length], languages: [{ code: 'nl' }] }));
      }
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as import('node:net').AddressInfo).port;
  const sidecar = path.join(userDataDir, 'fixture-diarize');
  const countFile = path.join(userDataDir, 'native-calls.txt');
  writeFileSync(sidecar, `#!/usr/bin/python3
import json,sys
from pathlib import Path
with open(${JSON.stringify(countFile)}, 'a') as stream: stream.write('call\\n')
mic = 'ch0_' in sys.argv[-1]
def embedding(index):
    value = [0.0] * 256
    value[index] = 1.0
    return value
a,b = (embedding(0),embedding(1)) if mic else (embedding(2),embedding(3))
print(json.dumps({'segments':[{'start':0,'end':8,'speakerId':'SPEAKER_0'},{'start':8,'end':12,'speakerId':'SPEAKER_1'}], 'speakers':{'SPEAKER_0':a,'SPEAKER_1':b}}))
`, { mode: 0o755 });
  enableSpeakerIdentification(userDataDir);
  writeUserConfig(userDataDir, { transcription_engine: 'openai-asr', openai_asr_model: 'gpt-transcribe',
    openai_asr_api_url: `http://127.0.0.1:${port}/v1`, auto_summarize_enabled: false,
    language: 'auto', privacy_notice_seen: true, keep_recordings: true });
  const stem = 'cloud-speaker-fixture';
  const recordings = path.join(userDataDir, 'recordings');
  mkdirSync(recordings, { recursive: true });
  const audio = makeWav(path.join(recordings, stem + '.wav'), { seconds: 12, channels: 2, amplitude: .2 });
  try {
    const { page } = await launchApp({ env: { STENOAI_DIARIZE_SIDECAR_PATH: sidecar }, releaseHighlightsSeen: true });
    const keyResult = await page.evaluate(() => (window as any).stenoai.openaiAsr.setKey('sk-cloud-fixture'));
    expect(keyResult.success).toBe(true);
    const queued = await page.evaluate(audioPath => (window as any).stenoai.recording.processSystemAudio(audioPath, 'Cloud speaker fixture'), audio);
    expect(queued.success).toBe(true);
    const summary = path.join(userDataDir, 'output', stem + '_summary.md');
    const speakers = path.join(userDataDir, 'output', stem + '_speakers.json');
    await expect.poll(() => existsSync(speakers) && existsSync(summary), { timeout: 90_000 }).toBe(true);
    await expect.poll(() => readFileSync(summary, 'utf8').includes('## Transcript'), { timeout: 15_000 }).toBe(true);
    expect(readFileSync(countFile, 'utf8').trim().split('\n')).toHaveLength(2);
    expect(requests).toHaveLength(5);
    expect(primaryCalls).toBe(4);
    for (const request of requests) {
      expect(request.auth).toBe('Bearer sk-cloud-fixture');
      expect(request.body).toContain(request.body.includes('gpt-4o-transcribe-diarize')
        ? 'diarized_json' : 'gpt-transcribe');
      expect(request.body).not.toContain('verbose_json');
    }
    expect(requests.filter(request => request.body.includes('gpt-4o-transcribe-diarize'))).toHaveLength(1);
    expect(requests.filter(request => request.body.includes('name="languages[]"'))).toHaveLength(2);
    const sidecarData = JSON.parse(readFileSync(speakers, 'utf8'));
    expect(sidecarData.transcript_lines.length).toBeGreaterThanOrEqual(4);
    expect(sidecarData.transcript_lines.every((line: any) => line.diarization_speaker_id)).toBe(true);
    const syncDir = path.join(userDataDir, 'sync-config');
    const vault = path.join(userDataDir, 'vault');
    mkdirSync(syncDir, { recursive: true });
    mkdirSync(vault, { recursive: true });
    writeFileSync(path.join(syncDir, 'config.json'), JSON.stringify({ vault,
      steno_output_dir: path.join(userDataDir, 'output'), settle_seconds: 0, link_from_daily_notes: false }));
    const sync = () => {
      const result = spawnSync('/usr/bin/python3', [path.resolve('..', 'custom', 'obsidian_sync.py')], {
        env: { PATH: process.env.PATH!, STENOAI_USER_DATA_DIR: userDataDir, STENOAI_SYNC_CONFIG_DIR: syncDir }, encoding: 'utf8',
      });
      expect(result.status, result.stderr).toBe(0);
    };
    sync();
    const transcriptDir = path.join(vault, 'StenoAI', 'Transcripts');
    const vaultTranscript = path.join(transcriptDir, readdirSync(transcriptDir)[0]);
    expect(readFileSync(vaultTranscript, 'utf8')).toContain('alpha');
    const confirmed = await page.evaluate(params => (window as any).stenoai.speakers.confirm(params), {
      meetingStem: stem, channel: 'system', diarizationSpeakerId: 'SPEAKER_0',
      expectedRunId: sidecarData.diarization_run.run_id, newPersonName: 'Alex Fixture', summaryFile: summary,
    });
    expect(confirmed.success, JSON.stringify(confirmed)).toBe(true);
    expect(readFileSync(summary, 'utf8')).toContain('[Alex Fixture]');
    sync();
    expect(readFileSync(vaultTranscript, 'utf8')).toContain('[Alex Fixture]');
    const noteDir = path.join(vault, 'StenoAI', 'Meeting notes');
    expect(readFileSync(path.join(noteDir, readdirSync(noteDir)[0]), 'utf8')).toContain('Alex Fixture');
    expect(fileSig(realUserDataDir())).toBe(realBefore);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
