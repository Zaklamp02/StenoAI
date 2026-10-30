'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

test('calendar retries failures, refreshes invitees, keeps occurrence identity, and respects unlink', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'calendar-refresh-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'apple-calendar.json'), JSON.stringify({ enabled: true }));
  const time = Date.now();
  const summary = path.join(dir, `sysaudio-${time}-fixture_summary.md`);
  fs.writeFileSync(summary, '---\n---\n');
  const sidecar = summary.replace('_summary.md', '_calendar.json');
  const event = { id: 'recurring', start: new Date(time - 60000).toISOString(), end: new Date(time + 60000).toISOString(), attendees: [{ name: 'Before' }] };
  let response = { success: false };
  let pendingCallback;
  let hold = false;
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'apple-calendar.js'), 'utf8'), {
    module, __dirname, process: { platform: 'darwin', pid: process.pid },
    require: name => name === 'child_process' ? { execFile: (_bin, _args, _opts, cb) => {
      if (hold) pendingCallback = cb;
      else cb(null, JSON.stringify(response));
    } }
      : name === 'fs' ? { ...fs, existsSync: p => String(p).endsWith('steno-calendar') || fs.existsSync(p) } : require(name),
  });
  const handlers = {};
  const calendar = module.exports.registerAppleCalendar({ ipcMain: { handle: (n, h) => { handlers[n] = h; } },
    app: { isPackaged: false }, getUserDataDir: () => dir, sendDebugLog() {}, isAllowedSummaryPath: p => p === summary });
  await assert.rejects(calendar.ensureMeetingCalendar(summary), /lookup failed/);
  assert.equal(fs.existsSync(sidecar), false);
  response = { success: true, events: [event] };
  assert.equal((await calendar.ensureMeetingCalendar(summary)).event.attendees[0].name, 'Before');
  response.events = [{ ...event, attendees: [{ name: 'After' }] }, { ...event, start: new Date(time + 86400000).toISOString() }];
  assert.equal((await handlers['update-meeting-calendar']({}, summary, { action: 'refresh' })).event.attendees[0].name, 'After');
  response = { success: false };
  assert.equal((await handlers['update-meeting-calendar']({}, summary, { action: 'refresh' })).success, false);
  assert.equal(JSON.parse(fs.readFileSync(sidecar)).event.attendees[0].name, 'After');
  await handlers['update-meeting-calendar']({}, summary, { action: 'unlink' });
  assert.equal((await calendar.ensureMeetingCalendar(summary, { force: true })).event, null);
  response = { success: true, events: [event] };
  const matched = await handlers['update-meeting-calendar']({}, summary, { action: 'match', eventId: event.id, eventStart: event.start });
  assert.equal(matched.success, true);
  hold = true;
  const background = calendar.ensureMeetingCalendar(summary, { force: true });
  await handlers['update-meeting-calendar']({}, summary, { action: 'unlink' });
  pendingCallback(null, JSON.stringify(response));
  assert.equal((await background).detached, true);
  assert.equal(JSON.parse(fs.readFileSync(sidecar)).detached, true);
  assert.equal((await handlers['meeting-calendar']({}, '/elsewhere_summary.md')).success, false);
});

test('a synced recording without a timestamp in its name links by its frontmatter date', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'calendar-synced-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'apple-calendar.json'), JSON.stringify({ enabled: true }));
  // A phone recording keeps its own file name; it started 24 min into the meeting.
  const summary = path.join(dir, 'Veneta martin molenkamp_summary.md');
  fs.writeFileSync(summary, '---\ntitle: "Koffie"\ndate: "2026-10-27T11:24:00"\nduration_seconds: 4582\n---\n');
  const meeting = { id: 'veneta', title: 'Koffie, Veneta x AI', start: '2026-10-27T11:00:00', end: '2026-10-27T12:30:00' };
  const other = { id: 'other', title: 'Later that day', start: '2026-10-27T15:00:00', end: '2026-10-27T16:00:00' };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'apple-calendar.js'), 'utf8'), {
    module, __dirname, process: { platform: 'darwin', pid: process.pid },
    require: name => name === 'child_process'
      ? { execFile: (_bin, _args, _opts, cb) => cb(null, JSON.stringify({ success: true, events: [meeting, other] })) }
      : name === 'fs' ? { ...fs, existsSync: p => String(p).endsWith('steno-calendar') || fs.existsSync(p) } : require(name),
  });
  const handlers = {};
  const calendar = module.exports.registerAppleCalendar({ ipcMain: { handle: (n, h) => { handlers[n] = h; } },
    app: { isPackaged: false }, getUserDataDir: () => dir, sendDebugLog() {}, isAllowedSummaryPath: p => p === summary });
  assert.equal((await calendar.ensureMeetingCalendar(summary)).event.id, 'veneta');
  // The manual chooser offers the day's meetings instead of an empty list.
  const options = await handlers['meeting-calendar-options']({}, summary);
  assert.equal(options.events.map(e => e.id).join(), 'veneta,other');
});

const { pickEventForRecording } = require('./apple-calendar');

// 26 Oct 2026, 13:00 local: three meetings start at once and two more follow
// at 13:30. The recording of "Safety products" started at 13:00:49 and ran
// 44 min, overrunning its 30-min slot.
const at = (hhmm) => `2026-10-26T${hhmm}:00+01:00`;
const overlapping = [
  { id: 'struyk', title: 'Struyk Verwo Infra Block ', start: at('13:00'), end: at('16:00'), response_status: 'accepted' },
  { id: 'nbs', title: 'NBS + AM + Solutions team + Marketing', start: at('13:00'), end: at('14:30'), response_status: 'accepted' },
  { id: 'safety', title: 'Safety products - Bespreken scope fase 1 incl. resterende feedback', start: at('13:00'), end: at('13:30'), response_status: 'accepted' },
  { id: 'jc', title: 'Youwe & JC-Electronics | JContinuity+', start: at('13:30'), end: at('14:00'), response_status: 'unknown' },
];
const recordedAt = Date.parse(at('13:00')) + 49734;

test('a recording named after an invitation links that invitation', () => {
  const safeName = 'Safety_products_-_Bespreken_scope_fase_1_incl__resterende_feedba';
  // Even when it ran 85 min, which fits the NBS slot best, in any event order.
  for (const events of [overlapping, [...overlapping].reverse()]) {
    const durationMs = 85 * 60000;
    assert.equal(pickEventForRecording(events, { startMs: recordedAt, durationMs, safeName }).id, 'safety');
    assert.equal(pickEventForRecording(events, { startMs: recordedAt, durationMs, safeName: 'Note' }).id, 'nbs');
  }
});

test('an unnamed recording links the meeting whose time span fits it best', () => {
  const pick = (durationMin, events = overlapping) => pickEventForRecording(events, {
    startMs: recordedAt, durationMs: durationMin * 60000, safeName: 'Note',
  }).id;
  assert.equal(pick(44), 'safety');
  assert.equal(pick(85), 'nbs');
  assert.equal(pick(175), 'struyk');
});

test('without a length, the closest start wins and ties go to the shorter accepted meeting', () => {
  const pick = (events, startMs = recordedAt) => pickEventForRecording(events, { startMs })?.id ?? null;
  assert.equal(pick(overlapping), 'safety');
  const tentative = overlapping.map((e) => (e.id === 'safety' ? { ...e, response_status: 'tentative' } : e));
  assert.equal(pick(tentative), 'nbs');
  // Joining a few minutes early picks the meeting about to start, not the one ending.
  const back = [
    { id: 'before', title: 'Before', start: at('12:00'), end: at('13:00'), response_status: 'accepted' },
    { id: 'next', title: 'Next', start: at('13:00'), end: at('13:30'), response_status: 'accepted' },
  ];
  assert.equal(pick(back, Date.parse(at('12:57'))), 'next');
});

test('all-day, declined and out-of-window events are never linked', () => {
  const events = [
    { id: 'allday', title: 'Holiday', start: '2026-10-26', end: '2026-10-27', is_all_day: true },
    { id: 'declined', title: 'Declined', start: at('13:00'), end: at('14:00'), response_status: 'declined' },
    { id: 'later', title: 'Later', start: at('13:20'), end: at('14:00'), response_status: 'accepted' },
  ];
  assert.equal(pickEventForRecording(events, { startMs: recordedAt }), null);
});

test('the calendar helper finds every Teams join-link shape in an invite', () => {
  // The helper is Swift; its pattern is plain ICU syntax that JS reads the same way.
  const swift = fs.readFileSync(path.join(__dirname, '..', 'custom', 'calendar-helper', 'steno-calendar.swift'), 'utf8');
  const pattern = new RegExp(swift.match(/pattern: #"(.*)"#/)[1], 'i');
  const find = text => (text.match(pattern) || [])[0];
  assert.equal(find('Deelnemen: https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc%40thread.v2/0?context=x'),
    'https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc%40thread.v2/0?context=x');
  // External invites: the short link is the only plain one, the long one is Safe Links-wrapped.
  assert.equal(find('Join: https://teams.microsoft.com/meet/3405056882574670?p=CXqAbc <https://eur03.safelinks.protection.outlook.com/?url=https%3A%2F%2Fteams.microsoft.com%2Fl%2Fmeetup-join%2F19>'),
    'https://teams.microsoft.com/meet/3405056882574670?p=CXqAbc');
  assert.equal(find('https://teams.cloud.microsoft/meet/123?p=abc'), 'https://teams.cloud.microsoft/meet/123?p=abc');
  assert.equal(find('https://teams.live.com/meet/9876'), 'https://teams.live.com/meet/9876');
  assert.equal(find('Options: https://teams.microsoft.com/meetingOptions/?organizerId=1'), undefined);
  assert.equal(find('Help: https://aka.ms/JoinTeamsMeeting?omkt=nl-NL'), undefined);
});
