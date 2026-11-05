'use strict';

// Checks for the organisation's Google sign-in (org-sso-google-start in
// main.js). Both close holes the security review reproduced:
//
// F07: the adapter's response chose the URL handed to shell.openExternal,
//   unchecked, so a malicious or intercepted adapter could make the OS open
//   a file: URL or any app's protocol handler. Only Google's own
//   authorisation endpoint is opened now.
// F08: the loopback callback put the `error` query parameter into HTML and
//   handled it before checking `state`, so any local page could inject markup
//   and cancel a sign-in in progress. State is checked first now; requests
//   with a wrong or missing state are answered and ignored, and every reply
//   is fixed plain text.

const GOOGLE_AUTH_ORIGIN = 'https://accounts.google.com';
const GOOGLE_AUTH_PATHS = new Set(['/o/oauth2/v2/auth', '/o/oauth2/auth']);

function validateGoogleAuthorizeUrl(raw) {
  let url;
  try {
    url = new URL(String(raw || ''));
  } catch {
    throw new Error('The organisation server returned an invalid sign-in address.');
  }
  if (
    url.origin !== GOOGLE_AUTH_ORIGIN
    || url.username
    || url.password
    || !GOOGLE_AUTH_PATHS.has(url.pathname)
  ) {
    throw new Error('The organisation server returned a sign-in address that is not Google\'s. Sign-in was stopped.');
  }
  return url.toString();
}

const RESPONSE_HEADERS = {
  'content-type': 'text/plain; charset=utf-8',
  'content-security-policy': "default-src 'none'",
  'x-content-type-options': 'nosniff',
  'cache-control': 'no-store',
};

// Decides what one request to the loopback server means. Returns
// { status, body, outcome } where outcome is 'ignore' (answer, keep waiting),
// 'denied' (the real Google redirect reported an error) or 'code' (with
// `code`). Nothing from the request appears in `body`.
function classifyCallback(requestUrl, expectedState) {
  const url = new URL(requestUrl, 'http://127.0.0.1');
  if (url.pathname !== '/callback') {
    return { status: 404, body: 'Not found.', outcome: 'ignore' };
  }
  const state = url.searchParams.get('state');
  if (!state || state !== expectedState) {
    return {
      status: 400,
      body: 'This sign-in link is not the one Steno is waiting for. You can close this window.',
      outcome: 'ignore',
    };
  }
  if (url.searchParams.get('error')) {
    return {
      status: 200,
      body: 'Sign-in was cancelled or refused. You can close this window and try again in Steno.',
      outcome: 'denied',
    };
  }
  const code = url.searchParams.get('code');
  if (!code) {
    return { status: 400, body: 'Sign-in failed. Close this window and try again in Steno.', outcome: 'ignore' };
  }
  return { status: 200, body: 'Signed in. You can close this window and return to Steno.', outcome: 'code', code };
}

module.exports = { validateGoogleAuthorizeUrl, classifyCallback, RESPONSE_HEADERS };
