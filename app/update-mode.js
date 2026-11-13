'use strict';

/**
 * Settings -> Preferences -> "Install updates automatically" chooses between
 * two update modes for an install that updates itself (update-signing.js):
 *
 * - On (default): electron-updater downloads a release in the background and
 *   installs it on Restart, on quit, or when idle (update-idle-gate.js).
 * - Off ("ask first"): nothing downloads until the user clicks Update in the
 *   pill. Once downloaded it installs only on Restart; quitting leaves it
 *   pending, because electron-updater hands a download to Squirrel.Mac only
 *   when autoInstallOnAppQuit is set or quitAndInstall is called.
 *
 * electron-updater reads both flags when a check or download runs, so main.js
 * applies them right before each one; flipping the switch needs no restart.
 */
function updaterOptionsFor(installAutomatically) {
  const automatic = installAutomatically !== false;
  return { autoDownload: automatic, autoInstallOnAppQuit: automatic };
}

/**
 * Whether a release can be fetched and installed in the app rather than
 * downloaded from GitHub. The updater reads full releases only, and a feed
 * that is missing or failed falls back to the DMG.
 */
function canUpdateInApp({ autoUpdateEnabled, prerelease, updateError, feedMissing }) {
  return autoUpdateEnabled === true && !prerelease && !updateError && !feedMissing;
}

module.exports = { updaterOptionsFor, canUpdateInApp };
