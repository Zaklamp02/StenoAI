'use strict';

// Keeps the first Keychain access off the startup path.
//
// safeStorage decrypts synchronously on the main thread. With a locked login
// Keychain (right after login, launch-at-login, after wake) that first access
// sits in SecItemCopyMatching until the user unlocks, and when it happened
// during startup the window never appeared. The gate starts closed: encrypted
// keys read as "not available yet" (the same transient state a locked
// Keychain already produced) and nothing touches the Keychain. It opens once
// the window is visible, or when a job needs its keys: it tells the renderer
// "waiting", gives it a moment to paint that, then performs the app's normal
// decrypt of one of its own encrypted files. Chromium keeps the Safe Storage
// key in memory after that, so later reads do not go back to the Keychain.
// The decrypted value is discarded; nothing is exported or cached here.
//
// A user without any encrypted file never gets a Keychain access at all.

const PAINT_DELAY_MS = 200;

function createKeychainGate({
  findEncryptedFile,
  decryptFile,
  notify = () => {},
  onLog = () => {},
  setTimer = setTimeout,
  paintDelayMs = PAINT_DELAY_MS,
}) {
  let state = 'closed'; // closed -> waiting -> open
  let opening = null;
  const openListeners = [];

  function log(message) {
    try { onLog(`[keychain] ${message}`); } catch { /* logging only */ }
  }

  function setState(next) {
    state = next;
    try { notify(next); } catch { /* renderer gone */ }
  }

  function finishOpen() {
    setState('open');
    for (const listener of openListeners.splice(0)) {
      try { listener(); } catch (e) { log(`open listener failed: ${e.message}`); }
    }
  }

  function open(reason = 'requested') {
    if (state === 'open') return Promise.resolve();
    if (opening) return opening;
    opening = new Promise((resolve) => {
      let file = null;
      try { file = findEncryptedFile(); } catch { file = null; }
      if (!file) {
        log(`opened (${reason}); no encrypted keys stored`);
        finishOpen();
        resolve();
        return;
      }
      setState('waiting');
      log(`waiting for Keychain (${reason})`);
      // Let the renderer paint "Waiting for Keychain" before the main thread
      // blocks in the synchronous decrypt.
      setTimer(() => {
        const startedAt = Date.now();
        try {
          decryptFile(file);
          log(`Keychain available after ${Date.now() - startedAt} ms`);
        } catch (e) {
          // Denied or cancelled: later reads retry through the normal path.
          log(`Keychain not available (${e.message}); keys load on next use`);
        }
        finishOpen();
        resolve();
      }, paintDelayMs);
    });
    return opening;
  }

  return {
    /** True once encrypted keys may be read. */
    isOpen: () => state === 'open',
    getState: () => state,
    open,
    /** Opens the gate if needed and resolves once it is open. */
    whenOpen: (reason) => open(reason),
    /** Runs `listener` once the gate is open (immediately if it already is),
     *  without opening it. */
    onOpen(listener) {
      if (state === 'open') listener();
      else openListeners.push(listener);
    },
  };
}

module.exports = { createKeychainGate, PAINT_DELAY_MS };
