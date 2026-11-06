'use strict';

const fs = require('fs');
const path = require('path');

// This build's releases, not the original StenoAI project's: its DMG would
// install the stock app over this one. The list (not /releases/latest) is read
// because tester releases are published as pre-releases, which /latest skips.
const RELEASES_URL = 'https://api.github.com/repos/Zaklamp02/StenoAI/releases?per_page=30';

// First check shortly after launch, then a few times a day so a Mac that stays
// open for weeks still hears about a release.
const FIRST_CHECK_DELAY_MS = 30 * 1000;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

const NOTICE_FILE = 'release-notice.json';

// Release tags are versions (v2026.11.1). Anything else, such as the earlier
// test-2026-11-06b tags, is not a release the app can compare against.
function parseVersion(value) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(value || '').trim());
  return match ? match.slice(1).map(Number) : null;
}

function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return 0;
  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) return left[i] < right[i] ? -1 : 1;
  }
  return 0;
}

function pickDmgAsset(assets, arch) {
  const dmgs = (Array.isArray(assets) ? assets : []).filter(
    (asset) => typeof asset?.name === 'string' && asset.name.endsWith('.dmg')
  );
  const match = dmgs.find((asset) => asset.name.includes(arch)) || dmgs[0];
  return match ? match.browser_download_url : null;
}

// Highest-versioned published release, or null when none carries a version tag.
function pickLatestRelease(releases) {
  let latest = null;
  for (const release of Array.isArray(releases) ? releases : []) {
    if (!release || release.draft || !parseVersion(release.tag_name)) continue;
    if (!latest || compareVersions(latest.tag_name, release.tag_name) < 0) latest = release;
  }
  return latest;
}

// The check-for-updates result for a GitHub releases list.
function summarizeReleases(releases, currentVersion, arch) {
  if (!Array.isArray(releases)) throw new Error('Unexpected releases response');
  const latest = pickLatestRelease(releases);
  if (!latest) {
    return {
      updateAvailable: false,
      currentVersion,
      latestVersion: currentVersion,
      releaseUrl: '',
      releaseName: '',
      downloadUrl: null,
    };
  }
  const latestVersion = latest.tag_name.replace(/^v/, '');
  return {
    updateAvailable: compareVersions(currentVersion, latestVersion) < 0,
    currentVersion,
    latestVersion,
    releaseUrl: latest.html_url,
    releaseName: latest.name || `Version ${latestVersion}`,
    downloadUrl: pickDmgAsset(latest.assets, arch),
  };
}

// Which versions were already announced: dismissed in the app, or shown as a
// system notification. Each release is announced once.
function readNoticeState(dir) {
  try {
    const state = JSON.parse(fs.readFileSync(path.join(dir, NOTICE_FILE), 'utf8'));
    return {
      dismissedVersion: parseVersion(state.dismissedVersion) ? state.dismissedVersion : null,
      notifiedVersion: parseVersion(state.notifiedVersion) ? state.notifiedVersion : null,
    };
  } catch {
    return { dismissedVersion: null, notifiedVersion: null };
  }
}

function writeNoticeState(dir, state) {
  const file = path.join(dir, NOTICE_FILE);
  const tmp = `${file}.tmp`;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, file);
}

function releaseNoticeFor(result, state) {
  if (!result?.updateAvailable || result.latestVersion === state.dismissedVersion) return null;
  return {
    version: result.latestVersion,
    releaseUrl: result.releaseUrl,
    downloadUrl: result.downloadUrl,
  };
}

module.exports = {
  RELEASES_URL,
  FIRST_CHECK_DELAY_MS,
  CHECK_INTERVAL_MS,
  parseVersion,
  compareVersions,
  pickDmgAsset,
  pickLatestRelease,
  summarizeReleases,
  readNoticeState,
  writeNoticeState,
  releaseNoticeFor,
};
