'use strict';

/**
 * How the in-app toast joins every Space and floats over full-screen apps.
 *
 * On macOS, Electron implements `visibleOnFullScreen` by calling
 * app.dock.hide(), which turns the whole app into a menu-bar-only
 * (UIElement) app: the Dock icon disappears after the first toast and never
 * comes back, whatever the user's "Hide Dock icon" setting says.
 * `skipTransformProcessType` keeps the app type as it is; the toast still
 * joins all Spaces and stays above normal windows.
 */
const TOAST_WORKSPACE_OPTIONS = Object.freeze({
  visibleOnFullScreen: true,
  skipTransformProcessType: true,
});

/**
 * Make the app the active one, for an explicit request to bring the window
 * forward (a notification, tray or deep-link click). Since macOS 14,
 * BrowserWindow.focus() from a background app is only a request that macOS may
 * refuse, so the window stays behind others; a click on the app's own
 * non-activating toast leaves it in the background too. Never call this for a
 * passive event: it takes focus from whatever the user is doing.
 */
function activateApp(app, platform = process.platform) {
  if (platform !== 'darwin') return false;
  app.focus({ steal: true });
  return true;
}

module.exports = { TOAST_WORKSPACE_OPTIONS, activateApp };
