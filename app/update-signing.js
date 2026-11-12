'use strict';

const path = require('path');
const { execFile } = require('child_process');

/**
 * Whether this install may update itself in place.
 *
 * macOS applies an update (Squirrel.Mac's ShipIt) only when the new app meets
 * the running app's designated requirement. For this build that requirement
 * pins the leaf certificate of the self-signed "StenoAI Local Signing"
 * identity releases are signed with, so only an install signed with that same
 * certificate can take a release. A build signed with any other identity (a
 * colleague's own per-Mac certificate, an ad-hoc dev build) would download
 * every release only to have ShipIt refuse it, so it keeps the "Download from
 * GitHub" notice instead.
 *
 * The value is the certificate's SHA-1 as `codesign -d -r-` prints it, not a
 * secret. A new release certificate means a new value here, and installs
 * signed with the old one need one manual reinstall.
 */
const RELEASE_SIGNING_CERT_SHA1 = '11d5b50e97811f5068a57c2ec501d5663f718818';

// <Name>.app/Contents/MacOS/<exe> -> <Name>.app, or null outside a bundle.
function appBundlePath(execPath) {
  const bundle = path.resolve(String(execPath || ''), '..', '..', '..');
  return bundle.endsWith('.app') ? bundle : null;
}

// The leaf certificate hash a designated requirement pins, lowercased, or null
// when the requirement is not certificate-based (ad-hoc builds pin a cdhash).
function designatedLeafSha1(codesignOutput) {
  const line = String(codesignOutput || '')
    .split('\n')
    .find((l) => l.startsWith('designated =>'));
  const match = line && /certificate leaf = H"([0-9a-fA-F]{40})"/.exec(line);
  return match ? match[1].toLowerCase() : null;
}

function readDesignatedRequirement(bundlePath) {
  return new Promise((resolve) => {
    execFile('/usr/bin/codesign', ['-d', '-r-', bundlePath], { timeout: 10000 }, (error, stdout, stderr) => {
      resolve(error ? null : `${stdout}\n${stderr}`);
    });
  });
}

/**
 * @returns {Promise<{eligible: boolean, reason: string}>}
 */
async function checkUpdateSigning({
  platform = process.platform,
  execPath = process.execPath,
  readRequirement = readDesignatedRequirement,
  expectedSha1 = RELEASE_SIGNING_CERT_SHA1,
} = {}) {
  if (platform !== 'darwin') return { eligible: false, reason: 'releases are macOS only' };
  const bundle = appBundlePath(execPath);
  if (!bundle) return { eligible: false, reason: 'not running from an app bundle' };
  const output = await readRequirement(bundle);
  if (!output) return { eligible: false, reason: 'could not read the code signature' };
  const leaf = designatedLeafSha1(output);
  if (!leaf) return { eligible: false, reason: 'not signed with a certificate' };
  if (leaf !== expectedSha1) return { eligible: false, reason: 'signed with a different certificate than releases' };
  return { eligible: true, reason: 'signed with the release certificate' };
}

module.exports = {
  RELEASE_SIGNING_CERT_SHA1,
  appBundlePath,
  designatedLeafSha1,
  checkUpdateSigning,
};
