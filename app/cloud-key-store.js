'use strict';

// The summarisation API key, bound to the destination it was entered for
// (security review F04). It used to be one undifferentiated encrypted key,
// handed to whatever endpoint the config named at the time, so switching
// the custom URL (or a compromised renderer doing so) sent the previous
// provider's key to a different operator.
//
// Now the encrypted blob is an envelope { version: 2, destination, key }.
// A job gets the key only while the config still names that destination,
// and it gets the destination too (STENOAI_CLOUD_KEY_DESTINATION), which
// Python checks against the config it actually uses (src/endpoint_policy.py
// cloud_key_destination: the format below must match it exactly).
//
// A pre-envelope key cannot prove where it was entered. It is adopted only
// for a first-party destination (OpenAI, Anthropic, Bedrock), where the
// endpoint is the provider's own and not something a URL field chose, and
// re-saved bound to it. For a custom endpoint it must be entered again.

const { requireSecureEndpoint } = require('./endpoint-policy');

const FIRST_PARTY_ORIGINS = {
  openai: 'https://api.openai.com',
  anthropic: 'https://api.anthropic.com',
};
const VALID_PROVIDERS = new Set(['openai', 'anthropic', 'bedrock', 'custom']);
const DEFAULT_BEDROCK_REGION = 'us-east-1';
// Same shape as src/config.py BEDROCK_REGION_RE (used with fullmatch).
const BEDROCK_REGION_RE = /^[a-z]{2}(-gov)?-[a-z]+-[0-9]{1,2}$/;
const ENVELOPE_VERSION = 2;

function customOrigin(rawUrl) {
  if (typeof rawUrl !== 'string' || !/^[\x21-\x7e]*$/.test(rawUrl.trim())) return null;
  try {
    const url = requireSecureEndpoint(rawUrl);
    if (!url || !/^https?:\/\//i.test(rawUrl.trim())) return null; // Python needs an explicit scheme
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function cloudKeyDestination({ provider, cloudApiUrl, bedrockRegion }) {
  const chosen = VALID_PROVIDERS.has(provider) ? provider : 'openai';
  if (FIRST_PARTY_ORIGINS[chosen]) return `${chosen}|${FIRST_PARTY_ORIGINS[chosen]}`;
  if (chosen === 'bedrock') {
    const region = typeof bedrockRegion === 'string' && bedrockRegion.trim()
      ? bedrockRegion.trim()
      : DEFAULT_BEDROCK_REGION;
    return BEDROCK_REGION_RE.test(region) ? `bedrock|https://bedrock-runtime.${region}.amazonaws.com` : null;
  }
  const origin = customOrigin(cloudApiUrl || '');
  return origin ? `custom|${origin}` : null;
}

// One read of config.json, so provider, URL and region describe the same
// moment. Fails closed (null) on anything but a missing file.
function readCloudKeyDestination({ fs, configPath }) {
  let config = {};
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8')) || {};
  } catch (error) {
    if (!error || error.code !== 'ENOENT') return null;
  }
  return cloudKeyDestination({
    provider: config.cloud_provider,
    cloudApiUrl: config.cloud_api_url,
    bedrockRegion: config.bedrock_region,
  });
}

function isFirstParty(destination) {
  return typeof destination === 'string' && /^(openai|anthropic|bedrock)\|/.test(destination);
}

function encodeEnvelope(key, destination) {
  return JSON.stringify({ version: ENVELOPE_VERSION, destination, key });
}

// What the stored plaintext means for this destination:
// { key } usable, { key, migrate: true } a legacy key adopted now, or null.
function decodeForDestination(plaintext, destination) {
  if (!destination || typeof plaintext !== 'string' || !plaintext) return null;
  let envelope = null;
  try {
    envelope = JSON.parse(plaintext);
  } catch {
    envelope = null;
  }
  if (envelope && typeof envelope === 'object' && envelope.version === ENVELOPE_VERSION) {
    return envelope.destination === destination && typeof envelope.key === 'string' && envelope.key
      ? { key: envelope.key }
      : null;
  }
  // A legacy blob: the raw key. Only a first-party destination adopts it.
  return isFirstParty(destination) ? { key: plaintext, migrate: true } : null;
}

module.exports = {
  cloudKeyDestination,
  readCloudKeyDestination,
  encodeEnvelope,
  decodeForDestination,
};
