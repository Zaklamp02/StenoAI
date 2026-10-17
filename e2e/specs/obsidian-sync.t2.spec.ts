import { test, expect } from '../fixtures/electron';
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, unlinkSync } from 'fs';
import path from 'path';

const BACKEND = path.resolve(
  __dirname, '..', '..', 'dist', 'stenoai',
  process.platform === 'win32' ? 'stenoai.exe' : 'stenoai',
);

const STEM = 'obsnote';
const NOTE_MD = `---
title: "Quarterly Planning"
date: 2026-07-20T10:00:00
is_diarised: true
---

## Summary

Ship the pricing page Friday. Bob owns the release notes.

## Participants

Alice, Bob

## Transcript

[You] we ship Friday.
[Others] I will prep the notes.

## User Notes

Follow up Monday.
`;

test('app-managed export keeps transcripts, stable links and vault edits after source updates/deletion', async ({ launchApp, userDataDir }) => {
  test.setTimeout(180_000);
  test.skip(!existsSync(BACKEND), 'backend bundle not built');
  const outputDir = path.join(userDataDir, 'output');
  mkdirSync(outputDir, { recursive: true });
  const summaryPath = path.join(outputDir, `${STEM}_summary.md`);
  writeFileSync(summaryPath, NOTE_MD, 'utf8');
  const vault = path.join(userDataDir, 'obs-vault');
  mkdirSync(vault);
  const syncDir = path.join(userDataDir, 'sync-config');
  mkdirSync(syncDir);
  writeFileSync(path.join(syncDir, 'config.json'), JSON.stringify({ vault, settle_seconds: 0, link_from_daily_notes: false }));
  const { page } = await launchApp({ env: { STENOAI_SYNC_CONFIG_DIR: syncDir } });
  await page.evaluate(async vault => {
    await window.stenoai.settings.setObsidianVaultPath(vault);
    await window.stenoai.settings.setObsidianSync(true);
    await window.stenoai.settings.retryObsidianSync();
  }, vault);
  const notesDir = path.join(vault, 'StenoAI', 'Meeting notes');
  const transcriptsDir = path.join(vault, 'StenoAI', 'Transcripts');
  await expect.poll(() => existsSync(notesDir) && readdirSync(notesDir).length).toBe(1);
  const note = path.join(notesDir, readdirSync(notesDir)[0]);
  const transcript = path.join(transcriptsDir, readdirSync(transcriptsDir)[0]);
  expect(readFileSync(note, 'utf8')).toContain('steno_id: obsnote');
  expect(readFileSync(transcript, 'utf8')).toContain('we ship Friday');
  expect(readFileSync(transcript, 'utf8')).toContain('Structured speaker data');
  writeFileSync(note, readFileSync(note, 'utf8') + '\nVault-only annotation.\n');
  await page.evaluate(async file => {
    await window.stenoai.meetings.update(file, { name: 'Renamed Planning' });
    await window.stenoai.settings.retryObsidianSync();
  }, summaryPath);
  expect(readdirSync(notesDir)).toHaveLength(1);
  expect(readFileSync(note, 'utf8')).toContain('Renamed Planning');
  expect(readFileSync(note, 'utf8')).toContain('Vault-only annotation.');
  // Removing the source retains the user-owned exported archive.
  unlinkSync(summaryPath);
  await page.evaluate(() => window.stenoai.settings.retryObsidianSync());
  expect(existsSync(note)).toBe(true);
  expect(existsSync(transcript)).toBe(true);
});
