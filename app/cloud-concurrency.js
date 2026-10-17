'use strict';

const fs = require('fs');
const path = require('path');

// How many cloud transcription requests may run at once, shared across both
// channels (Settings → AI → Cloud transcription). Passed to Python as
// STENOAI_OAI_PARALLELISM. Higher is faster until the provider rate-limits.
const DEFAULT_CONCURRENCY = 6;
const MIN_CONCURRENCY = 1;
const MAX_CONCURRENCY = 12;

function isValidConcurrency(value) {
  return Number.isInteger(value) && value >= MIN_CONCURRENCY && value <= MAX_CONCURRENCY;
}

function createCloudConcurrency({ getUserDataDir }) {
  const file = () => path.join(getUserDataDir(), 'cloud-concurrency.json');

  function get() {
    try {
      const { concurrency } = JSON.parse(fs.readFileSync(file(), 'utf8'));
      return isValidConcurrency(concurrency) ? concurrency : DEFAULT_CONCURRENCY;
    } catch {
      return DEFAULT_CONCURRENCY;
    }
  }

  function set(concurrency) {
    if (!isValidConcurrency(concurrency)) throw new Error('Invalid concurrency');
    const target = file();
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(`${target}.tmp`, JSON.stringify({ concurrency }), { mode: 0o600 });
    fs.renameSync(`${target}.tmp`, target);
  }

  return { get, set, env: () => String(get()) };
}

module.exports = {
  createCloudConcurrency, DEFAULT_CONCURRENCY, MIN_CONCURRENCY, MAX_CONCURRENCY,
};
