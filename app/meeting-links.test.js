'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { MEETING_URL_PATTERN, findMeetingUrl, teamsAppUrl } = require('./meeting-links');

const SHORT_TEAMS = 'https://teams.microsoft.com/meet/350516684657588?p=AfSrkE4NnN0myp4LMD';
const LONG_TEAMS =
  'https://teams.microsoft.com/l/meetup-join/19%3ameeting_NGZk%40thread.v2/0?context=%7b%22Tid%22%3a%221096%22%7d';

test('finds the short Teams link in an Outlook HTML body', () => {
  const body = `<p>Microsoft Teams-vergadering</p><p>Deelnemen: <a href="${SHORT_TEAMS}">${SHORT_TEAMS}</a></p>`;
  assert.strictEqual(findMeetingUrl(undefined, body), SHORT_TEAMS);
});

test('decodes &amp; between query parameters in an HTML body', () => {
  const body = '<a href="https://acme.zoom.us/j/123?pwd=abc&amp;from=addon">Join</a>';
  assert.strictEqual(findMeetingUrl(body), 'https://acme.zoom.us/j/123?pwd=abc&from=addon');
});

test('prefers the location over the body', () => {
  assert.strictEqual(
    findMeetingUrl('https://meet.google.com/abc-defg-hij', `see ${SHORT_TEAMS}`),
    'https://meet.google.com/abc-defg-hij',
  );
});

test('returns undefined without a meeting link', () => {
  assert.strictEqual(findMeetingUrl('Room 4.12', '<p>Agenda: https://example.com/doc</p>'), undefined);
  assert.strictEqual(findMeetingUrl(undefined, null), undefined);
});

test('both Teams link shapes open in the Teams app', () => {
  assert.strictEqual(teamsAppUrl(SHORT_TEAMS), 'msteams:/meet/350516684657588?p=AfSrkE4NnN0myp4LMD');
  assert.ok(teamsAppUrl(LONG_TEAMS).startsWith('msteams:/l/meetup-join/19%3ameeting_NGZk'));
  assert.ok(
    teamsAppUrl('https://teams.cloud.microsoft/meet/123?p=x').startsWith('msteams:/meet/123'),
  );
});

test('other links are not rewritten', () => {
  assert.strictEqual(teamsAppUrl('https://teams.microsoft.com/v2/'), null);
  assert.strictEqual(teamsAppUrl('http://teams.microsoft.com/meet/1'), null);
  assert.strictEqual(teamsAppUrl('https://evil.example/meet/1'), null);
  assert.strictEqual(teamsAppUrl('https://acme.zoom.us/j/123'), null);
  assert.strictEqual(teamsAppUrl('not a url'), null);
});

test('matches the same link shapes as the Apple Calendar helper', () => {
  const swift = fs.readFileSync(
    path.join(__dirname, '..', 'custom', 'calendar-helper', 'steno-calendar.swift'),
    'utf8',
  );
  const swiftPattern = swift.match(/pattern: #"(.*)"#/)[1];
  // Same regex once JS's escaped slashes are written plainly.
  assert.strictEqual(MEETING_URL_PATTERN.source.replace(/\\\//g, '/'), swiftPattern);
});
