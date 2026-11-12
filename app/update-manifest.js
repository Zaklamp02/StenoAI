'use strict';

/**
 * latest-mac.yml for a release built by custom/release.sh.
 *
 * electron-updater on an installed app reads this file from the newest full
 * GitHub release, compares `version`, downloads the zip named in `files`, and
 * checks it against `sha512` (base64, as electron-builder writes it) before
 * ShipIt installs it. `minimumSystemVersion` is the DARWIN version
 * (update-os-gate.js explains why the macOS one would be a no-op); it is what
 * keeps an older Mac from downloading a build it cannot launch.
 *
 *   node app/update-manifest.js <app.zip> <version> <out/latest-mac.yml>
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { darwinFloorForMacos, MIN_MACOS_FOR_AUTOUPDATE } = require('./update-os-gate');

function sha512Base64(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha512');
    fs.createReadStream(file)
      .on('error', reject)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('base64')));
  });
}

// Asset names stay plain so the URL needs no quoting in YAML and GitHub keeps
// the name as uploaded.
const SAFE_NAME = /^[A-Za-z0-9._-]+$/;
const VERSION = /^\d+\.\d+\.\d+$/;

function buildMacManifest({ version, zipName, sha512, size, releaseDate, minimumSystemVersion }) {
  if (!VERSION.test(String(version))) throw new Error(`Not a release version: ${version}`);
  if (!SAFE_NAME.test(String(zipName)) || !zipName.endsWith('.zip')) {
    throw new Error(`Unsupported zip name: ${zipName}`);
  }
  if (!/^[A-Za-z0-9+/]+=*$/.test(String(sha512))) throw new Error('sha512 must be base64');
  if (!Number.isInteger(size) || size <= 0) throw new Error('size must be a positive integer');
  if (!/^\d+\.\d+\.\d+$/.test(String(minimumSystemVersion))) {
    throw new Error(`Unparseable minimumSystemVersion: ${minimumSystemVersion}`);
  }
  return [
    `version: ${version}`,
    'files:',
    `  - url: ${zipName}`,
    `    sha512: ${sha512}`,
    `    size: ${size}`,
    `path: ${zipName}`,
    `sha512: ${sha512}`,
    `releaseDate: '${releaseDate}'`,
    `minimumSystemVersion: ${minimumSystemVersion}`,
    '',
  ].join('\n');
}

async function writeMacManifest(zipPath, version, outPath, now = new Date()) {
  const manifest = buildMacManifest({
    version,
    zipName: path.basename(zipPath),
    sha512: await sha512Base64(zipPath),
    size: fs.statSync(zipPath).size,
    releaseDate: now.toISOString(),
    minimumSystemVersion: darwinFloorForMacos(MIN_MACOS_FOR_AUTOUPDATE),
  });
  fs.writeFileSync(outPath, manifest);
  return manifest;
}

module.exports = { buildMacManifest, sha512Base64, writeMacManifest };

if (require.main === module) {
  const [zipPath, version, outPath] = process.argv.slice(2);
  if (!zipPath || !version || !outPath) {
    console.error('usage: node app/update-manifest.js <app.zip> <version> <out/latest-mac.yml>');
    process.exit(2);
  }
  writeMacManifest(zipPath, version, outPath)
    .then((manifest) => process.stdout.write(manifest))
    .catch((error) => {
      console.error(error.message);
      process.exit(1);
    });
}
