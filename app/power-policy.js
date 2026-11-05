'use strict';

const fs = require('fs');
const path = require('path');

/**
 * "Process meetings only when plugged in" (Settings → AI → When to process).
 *
 * Local transcription, speaker detection, summarisation and the live
 * transcript all run on this machine's CPU/GPU and drain a laptop battery
 * fast. With the `plugged_in` policy, main.js holds queued meetings (their
 * audio is already on disk and their journal entry says `waiting-power`) and
 * skips the live transcript while the machine runs on battery, then drains the
 * queue on powerMonitor 'on-ac'.
 *
 * The policy is read straight from config.json (no backend subprocess) because
 * it is consulted on every queue step. A missing or unreadable config means
 * `always`: a config hiccup must never silently stop meetings from processing.
 *
 * `STENOAI_E2E_POWER_SOURCE=battery|ac` replaces the OS power source under the
 * e2e suite only, so specs can exercise the battery path on any runner.
 */
const POLICIES = ['always', 'plugged_in'];

function createPowerPolicy({ getUserDataDir, isOnBatteryPower, env = process.env, isE2E = false }) {
  function policy() {
    try {
      const cfg = JSON.parse(fs.readFileSync(path.join(getUserDataDir(), 'config.json'), 'utf8'));
      return POLICIES.includes(cfg.processing_power_policy) ? cfg.processing_power_policy : 'always';
    } catch (_) {
      return 'always';
    }
  }
  function onBattery() {
    const simulated = isE2E ? env.STENOAI_E2E_POWER_SOURCE : undefined;
    if (simulated === 'battery') return true;
    if (simulated === 'ac') return false;
    try { return Boolean(isOnBatteryPower()); } catch (_) { return false; }
  }
  // True when heavy local work should wait for mains power right now.
  function shouldWait() {
    return policy() === 'plugged_in' && onBattery();
  }
  return { policy, onBattery, shouldWait };
}

module.exports = { createPowerPolicy, POLICIES };
