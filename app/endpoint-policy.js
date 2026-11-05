'use strict';

// Same transport rule as src/endpoint_policy.py, for the org adapter URL,
// which receives the sign-in password and then a session token on every
// call. Plain http only to this machine; never credentials in the URL.

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function isLoopbackHost(hostname) {
  const host = hostname.toLowerCase();
  if (LOOPBACK_HOSTS.has(host)) return true;
  // The whole 127.0.0.0/8 block is loopback, as in Python's ipaddress.
  return /^127(?:\.\d{1,3}){3}$/.test(host) && host.split('.').every((part) => Number(part) <= 255);
}

// Returns the cleaned URL ('' for empty input) or throws with a message fit
// to show. A bare host defaults to https (http for loopback, the one
// documented dev exception).
function requireSecureEndpoint(raw) {
  let value = String(raw || '').trim();
  if (!value) return '';
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    const host = value.split(/[/:?#]/)[0];
    value = (isLoopbackHost(host) || /^\[?::1\]?/.test(value) ? 'http://' : 'https://') + value;
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('That address is not a valid URL.');
  }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || !url.hostname) {
    throw new Error('Use an https:// address.');
  }
  if (url.username || url.password) {
    throw new Error('Remove the user name or password from the address.');
  }
  if (url.protocol === 'http:' && !isLoopbackHost(url.hostname)) {
    throw new Error('Use https:// for a server on another machine. Plain http is only allowed for this Mac (localhost).');
  }
  return value.replace(/\/+$/, '');
}

module.exports = { requireSecureEndpoint, isLoopbackHost };
