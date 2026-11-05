'use strict';

// Join links for the meeting services the app recognises. Same shapes as the
// Apple Calendar helper (custom/calendar-helper/steno-calendar.swift,
// meetingURLPattern): Teams has a long /l/meetup-join/ link and a short
// /meet/<id>?p=<passcode> one, on the old and the teams.cloud.microsoft host.
// Keep the two patterns in step so a meeting has a Join button whichever
// calendar it came from.
const MEETING_URL_PATTERN =
  /https:\/\/(?:teams\.(?:microsoft\.com|cloud\.microsoft)\/(?:l\/meetup-join|meet\/)|teams\.live\.com\/meet|[\w.-]*zoom\.us\/(?:j|my)|meet\.google\.com|[\w.-]*webex\.com\/(?:meet|join))[^\s<>"']*/i;

// HTML entities that survive in a join link taken from an invite body
// (Outlook returns the body as HTML: &amp; between query parameters).
function decodeEntities(url) {
  return url.replace(/&amp;/g, '&');
}

/** First meeting join link in any of the given texts, or undefined. */
function findMeetingUrl(...texts) {
  for (const text of texts) {
    if (typeof text !== 'string' || !text) continue;
    const match = text.match(MEETING_URL_PATTERN);
    if (match) return decodeEntities(match[0]);
  }
  return undefined;
}

const TEAMS_HOSTS = new Set(['teams.microsoft.com', 'teams.cloud.microsoft']);

/**
 * The msteams: deep link for a Teams join link, so it opens in the Teams app
 * instead of a browser tab that then hands over to Teams. Both link shapes
 * are rewritten; anything else returns null and opens as given.
 */
function teamsAppUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || !TEAMS_HOSTS.has(parsed.hostname)) return null;
  if (!parsed.pathname.startsWith('/l/meetup-join/') && !parsed.pathname.startsWith('/meet/')) {
    return null;
  }
  return `msteams:${parsed.pathname}${parsed.search}`;
}

module.exports = { MEETING_URL_PATTERN, findMeetingUrl, teamsAppUrl };
