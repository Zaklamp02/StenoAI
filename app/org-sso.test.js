'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { validateGoogleAuthorizeUrl, classifyCallback } = require('./org-sso');

test('only Google\'s authorisation endpoint may be opened (F07)', () => {
  const ok = 'https://accounts.google.com/o/oauth2/v2/auth?client_id=x&state=s';
  assert.strictEqual(validateGoogleAuthorizeUrl(ok), ok);
  for (const bad of [
    'file:///tmp/stenoai-audit-not-opened',
    'http://accounts.google.com/o/oauth2/v2/auth',
    'https://accounts.google.com.attacker.test/o/oauth2/v2/auth',
    'https://attacker.test/accounts.google.com/o/oauth2/v2/auth',
    'https://user:pass@accounts.google.com/o/oauth2/v2/auth',
    'https://accounts.google.com/ServiceLogin',
    'steno://record/start',
    'javascript:alert(1)',
    '',
    null,
  ]) {
    assert.throws(() => validateGoogleAuthorizeUrl(bad), /sign-in address/, String(bad));
  }
});

test('a callback with the wrong or no state is ignored and never echoed (F08)', () => {
  const marker = '<b id="audit-marker">AUDIT</b>';
  for (const query of [
    `state=wrong&error=${encodeURIComponent(marker)}`,
    `error=${encodeURIComponent(marker)}`,
    'state=wrong&code=abc',
    'code=abc',
  ]) {
    const result = classifyCallback(`/callback?${query}`, 'expected-state');
    assert.strictEqual(result.outcome, 'ignore', query);
    assert.strictEqual(result.status, 400);
    assert.ok(!result.body.includes('AUDIT') && !result.body.includes('<'), query);
  }
});

test('with the right state, an error ends sign-in without echoing it', () => {
  const result = classifyCallback('/callback?state=s&error=%3Cscript%3Ex%3C%2Fscript%3E', 's');
  assert.strictEqual(result.outcome, 'denied');
  assert.ok(!result.body.includes('script'));
});

test('with the right state and a code, sign-in continues', () => {
  assert.deepStrictEqual(
    classifyCallback('/callback?state=s&code=the-code', 's'),
    { status: 200, body: 'Signed in. You can close this window and return to Steno.', outcome: 'code', code: 'the-code' },
  );
  assert.strictEqual(classifyCallback('/callback?state=s', 's').outcome, 'ignore');
  assert.strictEqual(classifyCallback('/favicon.ico', 's').status, 404);
});
