'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  RELEASE_SIGNING_CERT_SHA1,
  appBundlePath,
  designatedLeafSha1,
  checkUpdateSigning,
} = require('./update-signing');

const EXEC = '/Applications/StenoAI.app/Contents/MacOS/StenoAI';
const requirement = (leaf) =>
  `Executable=${EXEC}\ndesignated => identifier "com.stenoai.recorder" and certificate leaf = H"${leaf}"\n`;

test('appBundlePath finds the .app around the executable', () => {
  assert.strictEqual(appBundlePath(EXEC), '/Applications/StenoAI.app');
  assert.strictEqual(appBundlePath('/usr/local/bin/electron'), null);
});

test('designatedLeafSha1 reads a certificate-based requirement only', () => {
  assert.strictEqual(designatedLeafSha1(requirement('11D5B50E97811F5068A57C2EC501D5663F718818')),
    '11d5b50e97811f5068a57c2ec501d5663f718818');
  // Ad-hoc builds pin a cdhash, which no other build can ever satisfy.
  assert.strictEqual(designatedLeafSha1('designated => cdhash H"0123456789abcdef0123456789abcdef01234567"'), null);
  // The hash must come from the designated line, not some other output.
  assert.strictEqual(designatedLeafSha1(`note certificate leaf = H"${'a'.repeat(40)}"`), null);
  assert.strictEqual(designatedLeafSha1(''), null);
});

test('only an app signed with the release certificate updates itself', async () => {
  const check = (output, extra = {}) =>
    checkUpdateSigning({ platform: 'darwin', execPath: EXEC, readRequirement: async () => output, ...extra });

  assert.deepStrictEqual(await check(requirement(RELEASE_SIGNING_CERT_SHA1)), {
    eligible: true,
    reason: 'signed with the release certificate',
  });
  assert.strictEqual((await check(requirement('b'.repeat(40)))).eligible, false);
  assert.strictEqual((await check('designated => cdhash H"00"')).eligible, false);
  assert.strictEqual((await check(null)).eligible, false);
  assert.strictEqual((await check(requirement(RELEASE_SIGNING_CERT_SHA1), { platform: 'win32' })).eligible, false);
  assert.strictEqual(
    (await check(requirement(RELEASE_SIGNING_CERT_SHA1), { execPath: '/opt/electron/electron' })).eligible,
    false,
  );
});

test('the release certificate pin is a lowercase SHA-1', () => {
  assert.match(RELEASE_SIGNING_CERT_SHA1, /^[0-9a-f]{40}$/);
});
