'use strict';

// PostHog project the app reports to when a user has opted in. This fork
// reports to its own project on PostHog's EU cloud; the upstream key is not
// used. With no key configured, telemetry stays off even for users who
// opted in: initTelemetry() and the opt-in handler never create a client.
//
// The project key is PostHog's public ingestion key (write-only, it cannot
// read data back), so it is safe in the shipped app. Developers can point a
// dev build at a scratch project with STENOAI_POSTHOG_KEY / STENOAI_POSTHOG_HOST.
const DEFAULT_POSTHOG_API_KEY = '';
const DEFAULT_POSTHOG_HOST = 'https://eu.i.posthog.com';

function resolvePosthogConfig(env = process.env) {
  const apiKey = (env.STENOAI_POSTHOG_KEY || DEFAULT_POSTHOG_API_KEY).trim();
  const host = (env.STENOAI_POSTHOG_HOST || DEFAULT_POSTHOG_HOST).trim();
  return { apiKey, host, configured: apiKey.startsWith('phc_') };
}

module.exports = { resolvePosthogConfig, DEFAULT_POSTHOG_HOST };
