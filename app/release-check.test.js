'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  RELEASES_URL,
  compareVersions,
  normalizeVersion,
  parseVersion,
  pickDmgAsset,
  readNoticeState,
  releaseNoticeFor,
  summarizeReleases,
  updateNoticeState,
  writeNoticeState,
} = require('./release-check');

const release = (tag, extra = {}) => ({
  tag_name: tag,
  name: `Release ${tag}`,
  html_url: `https://github.com/Zaklamp02/StenoAI/releases/tag/${tag}`,
  draft: false,
  prerelease: true,
  assets: [
    { name: `StenoAI-${tag}-arm64.dmg`, browser_download_url: `https://github.com/dl/${tag}.dmg` },
    { name: `StenoAI-${tag}-arm64.dmg.sha256`, browser_download_url: `https://github.com/dl/${tag}.sha256` },
  ],
  ...extra,
});

test('reads this repository, not the original project', () => {
  assert.match(RELEASES_URL, /^https:\/\/api\.github\.com\/repos\/Zaklamp02\/StenoAI\/releases/);
});

test('versions compare numerically and non-version tags are not versions', () => {
  assert.deepEqual(parseVersion('v2026.11.2'), [2026, 11, 2]);
  assert.equal(parseVersion('test-2026-11-06b'), null);
  assert.equal(parseVersion('1.2.3-beta'), null);
  assert.equal(compareVersions('2026.11.2', '2026.11.10'), -1);
  assert.equal(compareVersions('2026.12.1', '2026.11.9'), 1);
  assert.equal(compareVersions('0.8.0', '2026.11.1'), -1);
  assert.equal(compareVersions('v2026.11.1', '2026.11.1'), 0);
});

test('the newest version tag wins, including pre-releases, skipping drafts and old tags', () => {
  const result = summarizeReleases(
    [
      release('test-2026-11-06b'),
      release('v2026.11.10', { draft: true }),
      release('v2026.11.2'),
      release('v2026.11.9'),
    ],
    '2026.11.2',
    'arm64'
  );
  assert.equal(result.updateAvailable, true);
  assert.equal(result.latestVersion, '2026.11.9');
  assert.equal(result.releaseUrl, 'https://github.com/Zaklamp02/StenoAI/releases/tag/v2026.11.9');
  assert.equal(result.downloadUrl, 'https://github.com/dl/v2026.11.9.dmg');
});

test('no update when on the newest version or when no release has a version tag', () => {
  assert.equal(summarizeReleases([release('v2026.11.2')], '2026.11.2', 'arm64').updateAvailable, false);
  const none = summarizeReleases([release('test-2026-11-06b')], '0.8.0', 'arm64');
  assert.equal(none.updateAvailable, false);
  assert.equal(none.latestVersion, '0.8.0');
});

test('a non-list response (rate limit, error body) is a failed check', () => {
  assert.throws(() => summarizeReleases({ message: 'API rate limit exceeded' }, '0.8.0', 'arm64'));
});

test('the DMG for this architecture is preferred, never the checksum file', () => {
  const assets = [
    { name: 'StenoAI-x64.dmg', browser_download_url: 'x64' },
    { name: 'StenoAI-arm64.dmg.sha256', browser_download_url: 'sum' },
    { name: 'StenoAI-arm64.dmg', browser_download_url: 'arm' },
  ];
  assert.equal(pickDmgAsset(assets, 'arm64'), 'arm');
  assert.equal(pickDmgAsset(assets.slice(1, 2), 'arm64'), null);
  assert.equal(pickDmgAsset(undefined, 'arm64'), null);
});

test('a dismissed version is not announced again, a newer one is', () => {
  const result = summarizeReleases([release('v2026.11.3')], '2026.11.1', 'arm64');
  assert.equal(releaseNoticeFor(result, { dismissedVersion: '2026.11.3' }), null);
  assert.deepEqual(releaseNoticeFor(result, { dismissedVersion: '2026.11.2' }), {
    version: '2026.11.3',
    releaseUrl: 'https://github.com/Zaklamp02/StenoAI/releases/tag/v2026.11.3',
    downloadUrl: 'https://github.com/dl/v2026.11.3.dmg',
    prerelease: true,
  });
  assert.equal(releaseNoticeFor({ ...result, updateAvailable: false }, {}), null);
});

test('notice state round-trips and ignores a missing or corrupt file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-notice-'));
  try {
    assert.deepEqual(readNoticeState(dir), { dismissedVersion: null, notifiedVersion: null });
    writeNoticeState(dir, { dismissedVersion: '2026.11.3', notifiedVersion: '2026.11.4' });
    assert.deepEqual(readNoticeState(dir), { dismissedVersion: '2026.11.3', notifiedVersion: '2026.11.4' });
    fs.writeFileSync(path.join(dir, 'release-notice.json'), '{not json');
    assert.deepEqual(readNoticeState(dir), { dismissedVersion: null, notifiedVersion: null });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('versions are stored in one canonical form', () => {
  assert.equal(normalizeVersion('v2026.11.1'), '2026.11.1');
  assert.equal(normalizeVersion(' 2026.11.1 '), '2026.11.1');
  assert.equal(normalizeVersion(['2026.11.1']), null);
  assert.equal(normalizeVersion('2026.11.1-rc1'), null);
});

test('updating one field keeps the other', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-notice-'));
  try {
    updateNoticeState(dir, { dismissedVersion: '2026.11.3' });
    updateNoticeState(dir, { notifiedVersion: '2026.11.4' });
    assert.deepEqual(readNoticeState(dir), { dismissedVersion: '2026.11.3', notifiedVersion: '2026.11.4' });
    assert.deepEqual(fs.readdirSync(dir), ['release-notice.json']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the update config names this repository and a cache folder', () => {
  const yaml = require('js-yaml');
  const releaseCheck = require('./release-check');
  const parsed = yaml.load(releaseCheck.updateConfigYaml());
  assert.deepStrictEqual(parsed, {
    provider: 'github',
    owner: 'Zaklamp02',
    repo: 'StenoAI',
    updaterCacheDirName: 'stenoai-updater',
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'update-config-'));
  try {
    const file = releaseCheck.writeUpdateConfig(dir);
    assert.strictEqual(file, path.join(dir, 'app-update.yml'));
    assert.strictEqual(fs.readFileSync(file, 'utf8'), releaseCheck.updateConfigYaml());
    fs.writeFileSync(file, 'provider: generic\n');
    releaseCheck.writeUpdateConfig(dir);
    assert.strictEqual(fs.readFileSync(file, 'utf8'), releaseCheck.updateConfigYaml());
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a pre-release is marked so it is announced for download, not installed', () => {
  const releaseCheck = require('./release-check');
  const result = releaseCheck.summarizeReleases(
    [
      { tag_name: 'v2026.12.1', prerelease: true, html_url: 'https://github.com/x/y/releases/tag/v2026.12.1', assets: [] },
      { tag_name: 'v2026.11.2', prerelease: false, html_url: 'https://github.com/x/y/releases/tag/v2026.11.2', assets: [] },
    ],
    '2026.11.1',
    'arm64',
  );
  assert.equal(result.latestVersion, '2026.12.1');
  assert.equal(result.prerelease, true);
  const notice = releaseCheck.releaseNoticeFor(result, { dismissedVersion: null, notifiedVersion: null });
  assert.equal(notice.prerelease, true);
  const full = releaseCheck.summarizeReleases(
    [{ tag_name: 'v2026.11.2', html_url: 'https://github.com/x/y/releases/tag/v2026.11.2', assets: [] }],
    '2026.11.1',
    'arm64',
  );
  assert.equal(full.prerelease, false);
});
