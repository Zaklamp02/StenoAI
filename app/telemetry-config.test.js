'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { resolvePosthogConfig, DEFAULT_POSTHOG_HOST } = require('./telemetry-config');

test('defaults to the EU host', () => {
  assert.strictEqual(resolvePosthogConfig({}).host, DEFAULT_POSTHOG_HOST);
  assert.match(DEFAULT_POSTHOG_HOST, /^https:\/\/eu\./);
});

test('never ships the upstream project key', () => {
  const { apiKey } = resolvePosthogConfig({});
  assert.notStrictEqual(apiKey, 'phc_U2cnTyIyKGNSVaK18FyBMltd8nmN7uHxhhm21fAHwqb');
});

test('an environment key and host override the defaults', () => {
  const config = resolvePosthogConfig({
    STENOAI_POSTHOG_KEY: ' phc_dev ',
    STENOAI_POSTHOG_HOST: 'https://posthog.example.test',
  });
  assert.deepStrictEqual(config, {
    apiKey: 'phc_dev',
    host: 'https://posthog.example.test',
    configured: true,
  });
});

test('ships this fork\'s project key, so opted-in installs report', () => {
  assert.strictEqual(resolvePosthogConfig({}).configured, true);
  assert.strictEqual(resolvePosthogConfig({ STENOAI_POSTHOG_KEY: '' }).configured, true);
});

test('a malformed key leaves telemetry unconfigured', () => {
  assert.strictEqual(resolvePosthogConfig({ STENOAI_POSTHOG_KEY: 'not-a-key' }).configured, false);
});
