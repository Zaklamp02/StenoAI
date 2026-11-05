'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { requireSecureEndpoint } = require('./endpoint-policy');

test('https anywhere and http to this machine are allowed', () => {
  assert.strictEqual(requireSecureEndpoint('https://adapter.example.test/'), 'https://adapter.example.test');
  assert.strictEqual(requireSecureEndpoint('http://localhost:8000'), 'http://localhost:8000');
  assert.strictEqual(requireSecureEndpoint('http://127.0.0.5:8000'), 'http://127.0.0.5:8000');
  assert.strictEqual(requireSecureEndpoint('http://[::1]:8000'), 'http://[::1]:8000');
  assert.strictEqual(requireSecureEndpoint('HTTPS://Adapter.Example.Test'), 'HTTPS://Adapter.Example.Test');
});

test('a bare host defaults to https, or http for loopback', () => {
  assert.strictEqual(requireSecureEndpoint('adapter.example.test'), 'https://adapter.example.test');
  assert.strictEqual(requireSecureEndpoint('localhost:8000'), 'http://localhost:8000');
  assert.strictEqual(requireSecureEndpoint(''), '');
});

test('plain http to another machine is refused, LAN and look-alikes included', () => {
  for (const url of [
    'http://org.example.invalid:8000',
    'http://192.168.1.20:11434',
    'http://10.0.0.5',
    'http://localhost.attacker.test',
    'http://127.0.0.1.attacker.test',
    'http://[::2]:8000',
  ]) {
    assert.throws(() => requireSecureEndpoint(url), /https/, url);
  }
});

test('credentials in the URL, other schemes and malformed input are refused', () => {
  assert.throws(() => requireSecureEndpoint('https://user:pass@adapter.example.test'), /user name or password/);
  assert.throws(() => requireSecureEndpoint('file:///etc/passwd'), /https/);
  assert.throws(() => requireSecureEndpoint('ftp://adapter.example.test'), /https/);
  assert.throws(() => requireSecureEndpoint('https://adapter.example.test:99999'), /valid URL/);
});
