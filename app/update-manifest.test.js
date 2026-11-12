'use strict';

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');
const { buildMacManifest, writeMacManifest } = require('./update-manifest');
const { darwinFloorForMacos, MIN_MACOS_FOR_AUTOUPDATE } = require('./update-os-gate');

const BASE = {
  version: '2026.11.2',
  zipName: 'StenoAI-v2026.11.2-arm64-mac.zip',
  sha512: 'q83vEjRWeJA=',
  size: 1234,
  releaseDate: '2026-11-12T10:00:00.000Z',
  minimumSystemVersion: '23.4.0',
};

test('the manifest has the fields electron-updater reads', () => {
  const parsed = yaml.load(buildMacManifest(BASE));
  assert.deepStrictEqual(parsed, {
    version: '2026.11.2',
    files: [{ url: BASE.zipName, sha512: BASE.sha512, size: 1234 }],
    path: BASE.zipName,
    sha512: BASE.sha512,
    releaseDate: BASE.releaseDate,
    minimumSystemVersion: '23.4.0',
  });
  // A bare 2026.11.2 must stay a string, not be read as something else.
  assert.strictEqual(typeof parsed.version, 'string');
});

test('the manifest refuses values that would publish a broken feed', () => {
  assert.throws(() => buildMacManifest({ ...BASE, version: 'test-2026-11-06b' }));
  assert.throws(() => buildMacManifest({ ...BASE, zipName: 'StenoAI v1.zip' }));
  assert.throws(() => buildMacManifest({ ...BASE, zipName: 'StenoAI.dmg' }));
  assert.throws(() => buildMacManifest({ ...BASE, sha512: 'not base64!' }));
  assert.throws(() => buildMacManifest({ ...BASE, size: 0 }));
  assert.throws(() => buildMacManifest({ ...BASE, minimumSystemVersion: '' }));
});

test('writeMacManifest hashes the zip and writes the darwin floor', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'update-manifest-'));
  try {
    const zip = path.join(dir, 'StenoAI-v2026.11.2-arm64-mac.zip');
    fs.writeFileSync(zip, 'not really a zip');
    const out = path.join(dir, 'latest-mac.yml');
    await writeMacManifest(zip, '2026.11.2', out, new Date('2026-11-12T10:00:00Z'));
    const parsed = yaml.load(fs.readFileSync(out, 'utf8'));
    const expected = crypto.createHash('sha512').update('not really a zip').digest('base64');
    assert.strictEqual(parsed.sha512, expected);
    assert.strictEqual(parsed.files[0].size, 16);
    assert.strictEqual(parsed.minimumSystemVersion, darwinFloorForMacos(MIN_MACOS_FOR_AUTOUPDATE));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
