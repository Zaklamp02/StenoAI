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
