'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const {
  cloudKeyDestination, readCloudKeyDestination, encodeEnvelope, decodeForDestination,
} = require('./cloud-key-store');

// Shared with tests/test_cloud_key_binding.py: Python must derive the same
// destination from the same config, or a bound key would never be usable.
const CASES = JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', 'tests', 'fixtures', 'cloud_key_destinations.json'), 'utf8',
));

test('destinations match the shared table', () => {
  for (const c of CASES) {
    assert.strictEqual(
      cloudKeyDestination({ provider: c.provider, cloudApiUrl: c.cloud_api_url, bedrockRegion: c.bedrock_region }),
      c.destination,
      JSON.stringify(c),
    );
  }
});

test('a bound key is only released for its own destination', () => {
  const stored = encodeEnvelope('sk-FAKE', 'custom|https://a.example.test');
  assert.deepStrictEqual(decodeForDestination(stored, 'custom|https://a.example.test'), { key: 'sk-FAKE' });
  assert.strictEqual(decodeForDestination(stored, 'custom|https://b.example.test'), null);
  assert.strictEqual(decodeForDestination(stored, 'custom|https://a.example.test:8443'), null);
  assert.strictEqual(decodeForDestination(stored, 'openai|https://api.openai.com'), null);
  assert.strictEqual(decodeForDestination(stored, null), null);
});

test('a legacy unbound key is adopted only by a first-party destination', () => {
  assert.deepStrictEqual(
    decodeForDestination('sk-LEGACY', 'openai|https://api.openai.com'),
    { key: 'sk-LEGACY', migrate: true },
  );
  assert.deepStrictEqual(
    decodeForDestination('sk-LEGACY', 'bedrock|https://bedrock-runtime.eu-west-1.amazonaws.com'),
    { key: 'sk-LEGACY', migrate: true },
  );
  assert.strictEqual(decodeForDestination('sk-LEGACY', 'custom|https://api.example.test'), null);
});

test('the destination is read from one config snapshot and fails closed', () => {
  const read = (content) => readCloudKeyDestination({
    fs: { readFileSync: () => { if (content instanceof Error) throw content; return content; } },
    configPath: 'config.json',
  });
  assert.strictEqual(
    read(JSON.stringify({ cloud_provider: 'custom', cloud_api_url: 'https://api.example.test/v1' })),
    'custom|https://api.example.test',
  );
  assert.strictEqual(read(Object.assign(new Error('missing'), { code: 'ENOENT' })), 'openai|https://api.openai.com');
  assert.strictEqual(read(Object.assign(new Error('denied'), { code: 'EACCES' })), null);
  assert.strictEqual(read('{not json'), null);
});
